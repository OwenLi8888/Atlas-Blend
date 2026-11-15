import { createApp } from './app';
import { createServices } from './services';
const port = Number(process.env.PORT || 43871);
createApp(createServices()).listen(port, process.env.HOST || '127.0.0.1', () => console.log('Gallery API listening on ' + port));
