const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const marker = '# Keep constructors required by AndroidX WorkManager at startup.';
const rules = `${marker}\n-keep class * extends androidx.room.RoomDatabase { <init>(); }\n-keep class * extends androidx.work.InputMerger { <init>(); }\n`;

module.exports = function withAndroidWorkManagerKeepRules(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const rulesPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      let currentRules = '';
      try {
        currentRules = await fs.readFile(rulesPath, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!currentRules.includes(marker)) {
        await fs.appendFile(rulesPath, `\n${rules}`, 'utf8');
      }
      return config;
    },
  ]);
};
