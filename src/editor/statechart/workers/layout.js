import { runLayoutJob } from '../layout-job.js';
self.addEventListener('message', async ({ data }) => {
  const result = await runLayoutJob(data);
  if (result) self.postMessage(result);
});
