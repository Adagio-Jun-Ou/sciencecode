#!/usr/bin/env Rscript

# Persistent, file-protocol R worker for ScienceCode project kernels. It uses
# only base R so an optional R installation does not need extra packages.

MAX_STREAM_BYTES <- 1048576L
MAX_REPR_CHARACTERS <- 2000L
MAX_VARIABLES <- 128L
MAX_DEPENDENCIES <- 128L
kernel_env <- new.env(hash = TRUE, parent = globalenv())
protocol <- stdout()

clip_text <- function(value, limit = MAX_REPR_CHARACTERS) {
  text <- paste(as.character(value), collapse = "\n")
  if (nchar(text, type = "chars") <= limit) return(text)
  paste0(substr(text, 1L, limit - 1L), "…")
}

hex_encode <- function(value) {
  raw <- charToRaw(enc2utf8(paste(as.character(value), collapse = "")))
  if (!length(raw)) return("")
  paste(sprintf("%02x", as.integer(raw)), collapse = "")
}

emit <- function(...) {
  values <- vapply(list(...), function(value) {
    gsub("[\t\r\n]", " ", as.character(value))
  }, character(1))
  writeLines(paste(values, collapse = "\t"), protocol, sep = "\n", useBytes = TRUE)
  flush(protocol)
}

safe_repr <- function(value) {
  tryCatch(
    clip_text(capture.output(str(value, max.level = 1L, give.attr = FALSE, vec.len = 8L))),
    error = function(condition) paste0("<repr failed: ", class(condition)[1L], ">")
  )
}

truncate_file <- function(file, limit = MAX_STREAM_BYTES) {
  size <- file.info(file)$size
  if (is.na(size) || size <= limit) return(FALSE)
  connection <- file(file, open = "rb")
  on.exit(close(connection), add = TRUE)
  content <- readBin(connection, what = "raw", n = limit)
  close(connection)
  on.exit(NULL, add = FALSE)
  output <- file(file, open = "wb")
  on.exit(close(output), add = TRUE)
  writeBin(content, output)
  writeBin(charToRaw("\n[ScienceCode output truncated]\n"), output)
  TRUE
}

variable_rows <- function() {
  names <- sort(ls(envir = kernel_env, all.names = FALSE))
  rows <- character()
  if (!length(names)) return(list(rows = rows, truncated = FALSE))
  for (name in head(names, MAX_VARIABLES)) {
    value <- get(name, envir = kernel_env, inherits = FALSE)
    type <- paste(c(typeof(value), class(value)), collapse = "/")
    dimensions <- tryCatch(dim(value), error = function(condition) NULL)
    shape <- if (!is.null(dimensions)) {
      paste(head(dimensions, 8L), collapse = "x")
    } else {
      tryCatch(as.character(length(value)), error = function(condition) "")
    }
    bytes <- tryCatch(as.character(as.numeric(object.size(value))), error = function(condition) "")
    rows <- c(rows, paste(
      "variable",
      hex_encode(clip_text(name, 160L)),
      hex_encode(clip_text(type, 240L)),
      hex_encode(safe_repr(value)),
      hex_encode(shape),
      hex_encode(bytes),
      sep = "\t"
    ))
  }
  list(rows = rows, truncated = length(names) > MAX_VARIABLES)
}

dependency_rows <- function() {
  builtins <- c(
    "base", "compiler", "datasets", "graphics", "grDevices", "grid",
    "methods", "parallel", "splines", "stats", "tcltk", "tools", "utils"
  )
  packages <- sort(setdiff(loadedNamespaces(), builtins))
  rows <- character()
  for (name in head(packages, MAX_DEPENDENCIES)) {
    version <- tryCatch(as.character(packageVersion(name)), error = function(condition) "")
    rows <- c(rows, paste(
      "dependency",
      hex_encode(clip_text(name, 160L)),
      hex_encode(clip_text(version, 160L)),
      sep = "\t"
    ))
  }
  rows
}

write_response <- function(directory, response) {
  variables <- variable_rows()
  metadata <- c(
    protocol_version = "1",
    language = "r",
    language_version = as.character(getRversion()),
    implementation = paste(R.version$platform, R.version$arch, sep = "/"),
    status = response$status,
    duration_ms = as.character(response$duration_ms),
    stdout_truncated = if (response$stdout_truncated) "true" else "false",
    stderr_truncated = if (response$stderr_truncated) "true" else "false",
    result_visible = if (response$result_visible) "true" else "false",
    result_type = response$result_type,
    result_repr = response$result_repr,
    error_type = response$error_type,
    error_message = response$error_message,
    error_traceback = response$error_traceback,
    variables_truncated = if (variables$truncated) "true" else "false"
  )
  rows <- vapply(names(metadata), function(name) {
    paste("meta", hex_encode(name), hex_encode(metadata[[name]]), sep = "\t")
  }, character(1))
  rows <- c(rows, variables$rows, dependency_rows())
  writeLines(rows, file.path(directory, "result.tsv"), useBytes = TRUE)
}

execute_request <- function(directory) {
  source_file <- file.path(directory, "source.R")
  stdout_file <- file.path(directory, "stdout.txt")
  stderr_file <- file.path(directory, "stderr.txt")
  code <- paste(readLines(source_file, warn = FALSE, encoding = "UTF-8"), collapse = "\n")
  started <- proc.time()[["elapsed"]]
  status <- "completed"
  result_visible <- FALSE
  result_value <- NULL
  error_type <- ""
  error_message <- ""
  error_traceback <- ""
  output_connection <- file(stdout_file, open = "wt", encoding = "UTF-8")
  error_connection <- file(stderr_file, open = "wt", encoding = "UTF-8")
  output_sinks <- sink.number(type = "output")
  message_sinks <- sink.number(type = "message")
  sink(output_connection, type = "output")
  sink(error_connection, type = "message")

  tryCatch({
    expressions <- parse(text = code, keep.source = TRUE, srcfile = source_file)
    if (length(expressions)) {
      for (expression in expressions) {
        result <- withVisible(eval(expression, envir = kernel_env))
        result_value <- result$value
        result_visible <- isTRUE(result$visible)
        if (result_visible) print(result_value)
      }
    }
  }, error = function(condition) {
    status <<- "error"
    error_type <<- paste(class(condition), collapse = "/")
    error_message <<- conditionMessage(condition)
    call <- conditionCall(condition)
    error_traceback <<- if (is.null(call)) "" else paste(deparse(call), collapse = "\n")
  })

  while (sink.number(type = "message") > message_sinks) sink(type = "message")
  while (sink.number(type = "output") > output_sinks) sink(type = "output")
  try(close(error_connection), silent = TRUE)
  try(close(output_connection), silent = TRUE)
  stdout_truncated <- truncate_file(stdout_file)
  stderr_truncated <- truncate_file(stderr_file)
  result_type <- if (result_visible) paste(c(typeof(result_value), class(result_value)), collapse = "/") else ""
  result_repr <- if (result_visible) safe_repr(result_value) else ""
  response <- list(
    status = status,
    duration_ms = round((proc.time()[["elapsed"]] - started) * 1000),
    stdout_truncated = stdout_truncated,
    stderr_truncated = stderr_truncated,
    result_visible = result_visible,
    result_type = clip_text(result_type, 240L),
    result_repr = result_repr,
    error_type = clip_text(error_type, 240L),
    error_message = clip_text(error_message, 4000L),
    error_traceback = clip_text(error_traceback, 32000L)
  )
  write_response(directory, response)
}

emit("READY", "r", as.character(getRversion()), Sys.getpid())
repeat {
  line <- readLines(stdin(), n = 1L, warn = FALSE)
  if (!length(line)) break
  if (identical(line, "SHUTDOWN")) {
    emit("BYE")
    break
  }
  parts <- strsplit(line, "\t", fixed = TRUE)[[1L]]
  if (length(parts) < 3L || !identical(parts[[1L]], "EXEC")) {
    emit("PROTOCOL_ERROR", "invalid_request")
    next
  }
  request_id <- parts[[2L]]
  directory <- paste(parts[3:length(parts)], collapse = "\t")
  tryCatch({
    execute_request(directory)
    emit("DONE", request_id)
  }, error = function(condition) {
    try(writeLines(
      paste0(class(condition)[1L], ": ", conditionMessage(condition)),
      file.path(directory, "worker-error.txt"),
      useBytes = TRUE
    ), silent = TRUE)
    emit("FAILED", request_id, class(condition)[1L])
  })
}
