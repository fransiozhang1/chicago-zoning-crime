import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chicago.crimesim',
  appName: 'Chicago Crime Sim',
  webDir: 'dist',
  server: {
    androidScheme: 'http'
  }
};

export default config;
