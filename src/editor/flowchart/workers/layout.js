import { runLayoutJob } from '../layout-job.js';
// ELK may assign self.onmessage; keep the editor listener independent.
self.addEventListener('message', async ({ data }) => {
  const reply = await runLayoutJob(data);
  if (reply) self.postMessage(reply);
});
