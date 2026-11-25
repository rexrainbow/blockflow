import { createLayoutJobRunner } from '../layout-job.js';

const runLayoutJob = createLayoutJobRunner();

self.addEventListener('message', async ({ data }) => {
  // ELK's bundled worker can assign self.onmessage internally. Keep our document
  // listener independent so an idle worker can handle subsequent layout jobs.
  const result = await runLayoutJob(data);
  if (result) self.postMessage(result);
});
