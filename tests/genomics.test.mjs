import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasToGenomePosition,
  fitGenomeView,
  genomePositionToCanvas,
  genomeTicks,
  nearestGenomeFeature,
  panGenomeView,
  parseGenomeDocument,
  visibleGenomeFeatures,
  zoomGenomeView
} from '../lab/genomics.js';

test('BED and bedGraph parsing preserve coordinate and signal semantics', () => {
  const bed = parseGenomeDocument([
    'track name="peaks"',
    'chr1\t10\t30\tpeak-a\t42\t+',
    'chr1\t35\t50\tpeak-b\t10\t-',
    'chr2\t0\t8\tpeak-c'
  ].join('\n'), 'bed');
  assert.equal(bed.stats.feature_count, 3);
  assert.deepEqual(bed.contigs.map(({ name, length }) => ({ name, length })), [
    { name: 'chr1', length: 50 },
    { name: 'chr2', length: 8 }
  ]);
  assert.deepEqual(bed.features[0], {
    index: 0, row: 2, contig: 'chr1', start: 10, end: 30,
    type: 'interval', name: 'peak-a', score: 42, value: null,
    strand: '+', source: '', ref: '', alt: [], filter: '', attributes: {}
  });

  const graph = parseGenomeDocument('chr1\t0\t20\t1.25\nchr1\t20\t40\t-0.5', 'bedgraph');
  assert.deepEqual(graph.features.map((feature) => feature.value), [1.25, -0.5]);
  assert.deepEqual(graph.stats.types, ['signal']);
});

test('GFF/GTF and VCF normalize one-based records to zero-based half-open tracks', () => {
  const gff = parseGenomeDocument([
    '##gff-version 3',
    'chr7\tRefSeq\tgene\t101\t250\t.\t+\t.\tID=g1;Name=TP53',
    'chr7\tRefSeq\texon\t121\t150\t8.5\t+\t0\tParent=g1'
  ].join('\n'), 'gff3');
  assert.equal(gff.features[0].start, 100);
  assert.equal(gff.features[0].end, 250);
  assert.equal(gff.features[0].name, 'TP53');
  assert.equal(gff.features[1].attributes.Parent, 'g1');

  const vcf = parseGenomeDocument([
    '##fileformat=VCFv4.3',
    '##contig=<ID=chr7,length=1000>',
    '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO',
    'chr7\t151\trs1\tA\tG,T\t99\tPASS\tDP=42',
    'chr7\t401\t.\tN\t<DEL>\t.\tPASS\tEND=480'
  ].join('\n'), 'vcf');
  assert.equal(vcf.contigs[0].length, 1000);
  assert.deepEqual(vcf.features[0].alt, ['G', 'T']);
  assert.equal(vcf.features[0].start, 150);
  assert.equal(vcf.features[0].end, 151);
  assert.equal(vcf.features[1].start, 400);
  assert.equal(vcf.features[1].end, 480);
});

test('FASTA and feature ingestion are bounded with truthful retained lengths', () => {
  const fasta = parseGenomeDocument('>chrA example\nACGTACGT\n>chrB\nNNNN', 'fasta', {
    maxSequenceBases: 10
  });
  assert.equal(fasta.contigs[0].sequence, 'ACGTACGT');
  assert.equal(fasta.contigs[1].sequence, 'NN');
  assert.equal(fasta.contigs[1].length, 4);
  assert.equal(fasta.stats.sequence_bases_loaded, 10);
  assert.match(fasta.warnings[0], /truncated/i);

  const bounded = parseGenomeDocument([
    'chr1\t0\t1', 'chr1\t1\t2', 'chr1\t2\t3', 'chr1\t3\t4'
  ].join('\n'), 'bed', { maxFeatures: 3 });
  assert.equal(bounded.features.length, 3);
  assert.equal(bounded.stats.truncated, true);
  assert.match(bounded.warnings.at(-1), /first 3/);

  const contigBounded = parseGenomeDocument('chr1\t0\t1\nchr2\t0\t1', 'bed', { maxContigs: 1 });
  assert.deepEqual(contigBounded.contigs.map((contig) => contig.name), ['chr1']);
  assert.equal(contigBounded.features.length, 1);
  assert.match(contigBounded.warnings.at(-1), /contig limit/);
});

test('genome viewport transforms, filtering, ticks, and selection remain deterministic', () => {
  const document = parseGenomeDocument([
    'chr1\t100\t200\ta',
    'chr1\t350\t410\tb',
    'chr1\t800\t900\tc'
  ].join('\n'), 'bed');
  const full = fitGenomeView(document, 'chr1');
  const x = genomePositionToCanvas(350, full, 900);
  const restored = canvasToGenomePosition(x, full, 900);
  assert.ok(Math.abs(restored - 350) < 1e-10);
  const zoomed = zoomGenomeView(full, 0.25, 350);
  assert.ok(zoomed.end - zoomed.start < full.end - full.start);
  assert.ok(zoomed.start <= 350 && zoomed.end >= 350);
  const panned = panGenomeView(zoomed, 10_000);
  assert.equal(panned.end, full.length);
  const visible = visibleGenomeFeatures(document, zoomed, new Set(['interval']));
  assert.equal(visible.length, 1);
  assert.equal(nearestGenomeFeature(visible, 355)?.feature.name, 'b');
  assert.ok(genomeTicks(zoomed).length >= 2);
  assert.deepEqual(visibleGenomeFeatures(document, zoomed, new Set(['variant'])), []);
});
