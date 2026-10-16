import { grantAdmin } from '../admin';
import { runAdminCommand } from './admin-command';

await runAdminCommand('admin:grant', 'granted', grantAdmin);
