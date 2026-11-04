import { createMockCrm } from './app';

const port = Number(process.env.PORT ?? 4000);
const failRate = Number(process.env.FAIL_RATE ?? 0);
const apiKey = process.env.CRM_API_KEY ?? 'dev-crm-key';

createMockCrm({ apiKey, failRate }).listen(port, () => {
  console.log(`mock CRM listening on port ${port} (fail rate ${failRate})`);
});
