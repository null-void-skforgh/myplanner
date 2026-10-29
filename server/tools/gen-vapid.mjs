// 通知用の鍵（VAPID）を作って JSON を出力する。出力は `wrangler secret put VAPID_PRIVATE_JWK` にそのまま渡す。
import { generateVapidKeys } from '../src/webpush.js';
const { privateJwk } = await generateVapidKeys();
process.stdout.write(JSON.stringify(privateJwk));
