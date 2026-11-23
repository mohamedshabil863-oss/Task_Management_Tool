import 'dotenv/config';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { createDueSoonNotifications } from './routes/notifications.js';

const PORT = Number(process.env.PORT) || 4000;

await migrate();
const app = createApp();
app.listen(PORT, () => console.log(`TaskBoard running on http://localhost:${PORT}`));

// Hourly "due tomorrow" reminders.
const remind = () => createDueSoonNotifications().catch((err) => console.error('Due-date reminders failed:', err.message));
remind();
setInterval(remind, 60 * 60 * 1000).unref();
