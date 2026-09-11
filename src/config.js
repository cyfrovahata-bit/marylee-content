import path from 'node:path';

export const YOUTUBE_STORIS_FOLDER = '1sIcjn1IYI4uuw6TsBwyiKUKN6eNQUpXJ';
export const DEFAULT_SETTINGS = Object.freeze({
  autoPrepare: true, prepareTime: '22:30', voiceEnabled: true,
  includeOptionalStory: false, cooldownDays: 7, dailyBudget: 5,
  driveAutoImport: false, driveAutoExport: false, queueSheetId:'', driveQueueMonitor:true,
});

export function configFrom(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const dataDir = path.resolve(env.MARYLEE_DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || './data');
  const setupErrors = [];
  if (env.RAILWAY_ENVIRONMENT_ID && !env.RAILWAY_VOLUME_MOUNT_PATH) {
    setupErrors.push('Додай до цього сервісу окремий Railway Volume у /data: каталог має переживати перевстановлення. RAILWAY_VOLUME_MOUNT_PATH Railway задає автоматично після підключення Volume.');
  }
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    const mount = path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH);
    if (dataDir !== mount && !dataDir.startsWith(mount + path.sep)) setupErrors.push('MARYLEE_DATA_DIR має бути всередині окремого Volume. Прибери цю змінну для автоматичного вибору або задай фактичний mount path.');
  }
  const parent = env.MARYLEE_DRIVE_PARENT_ID || '';
  if (parent && parent !== YOUTUBE_STORIS_FOLDER) throw new Error('Marylee дозволено працювати лише всередині YouTube Storis. Перевір MARYLEE_DRIVE_PARENT_ID.');
  if (setupErrors.length) throw new Error('Marylee Content: запуск зупинено, потрібно завершити налаштування.\n' + setupErrors.map((message, index) => `${index + 1}. ${message}`).join('\n'));
  const positive = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Некоректна змінна ${name}`);
    return value;
  };
  return {
    production, dataDir, port: Number(env.PORT || 3000),
    host: production ? '0.0.0.0' : (env.HOST || '127.0.0.1'),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    driveParent: parent,
    googleClient: env.GOOGLE_OAUTH_CLIENT_ID || '', googleSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    googleRefresh: env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
    openaiKey: env.OPENAI_API_KEY || '', textModel: env.MARYLEE_TEXT_MODEL || 'gpt-4.1',
    imageModel: env.MARYLEE_IMAGE_MODEL || 'gpt-image-1',
    // Marylee has its own voice profile; legacy YouTube/TikTok TTS settings
    // must not silently select the old channel voice.
    voiceProvider: ['elevenlabs', 'eleven'].includes(env.MARYLEE_TTS_ENGINE) ? 'elevenlabs' : 'openai',
    openaiVoice: env.MARYLEE_OPENAI_VOICE || 'marin', elevenKey: env.ELEVENLABS_API_KEY || '',
    elevenVoice: env.TTS_ELEVEN_VOICE_ID || '', elevenModel: env.TTS_ELEVEN_MODEL || 'eleven_multilingual_v2',
    textReserve: positive('MARYLEE_TEXT_RESERVE_USD', .10),
    imageReserve: positive('MARYLEE_IMAGE_RESERVE_USD', .30),
    voiceReserve: positive('MARYLEE_VOICE_RESERVE_PER_1000', .50),
    maxUploadBytes: 200 * 1024 * 1024,
  };
}

export function validateSettings(value) {
  const next = {};
  for (const key of ['autoPrepare','voiceEnabled','includeOptionalStory','driveAutoImport','driveAutoExport','driveQueueMonitor']) {
    if (key in value) { if (typeof value[key] !== 'boolean') throw new Error('Некоректний перемикач'); next[key] = value[key]; }
  }
  if('queueSheetId' in value){if(typeof value.queueSheetId!=='string'||!/^([a-zA-Z0-9_-]{5,150})?$/.test(value.queueSheetId))throw new Error('Встав ідентифікатор таблиці Google Sheets');next.queueSheetId=value.queueSheetId;}
  if ('prepareTime' in value) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.prepareTime)) throw new Error('Час має бути у форматі ГГ:ХХ');
    next.prepareTime = value.prepareTime;
  }
  for (const [key,min,max] of [['cooldownDays',3,30],['dailyBudget',.1,50]]) {
    if (key in value) {
      const n = Number(value[key]);
      if (!Number.isFinite(n) || n < min || n > max || (key === 'cooldownDays' && !Number.isInteger(n))) throw new Error(`Некоректне значення ${key}`);
      next[key] = n;
    }
  }
  return next;
}
