import { performance } from 'node:perf_hooks';
import { createLocalBergamotTranslator } from './bergamot-runtime.mjs';

const samples = [
  { from: 'en', to: 'zh', text: 'Machine learning helps computers learn patterns from data.' },
  { from: 'zh', to: 'en', text: '机器学习让计算机能够从数据中学习规律。' },
];

const translator = createLocalBergamotTranslator({ batchSize: 2 });
try {
  for (const sample of samples) {
    const startedAt = performance.now();
    const response = await translator.translate({ ...sample, html: false, qualityScores: false });
    console.log(`${sample.from}->${sample.to} ${(performance.now() - startedAt).toFixed(1)} ms`);
    console.log(response.target.text);
  }
} finally {
  await translator.delete();
}
