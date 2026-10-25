# Example

This uses ScienceCode's package-local engine and isolated ScienceCode state; it
does not use a global OpenCode installation.

```bash
sciencecode init
sciencecode preregister freeze preregistration.md --name treatment-effect-demo
sciencecode run -- "Given measurements.csv, estimate the treatment effect, report uncertainty, test assumptions, run one sensitivity analysis, and ask the reproducibility reviewer to independently check the result. Do not modify the raw input file."
sciencecode gate
```
