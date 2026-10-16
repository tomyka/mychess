import { disableAccount } from '../admin';
import { runAdminCommand } from './admin-command';

await runAdminCommand('admin:disable', 'disabled', disableAccount);
