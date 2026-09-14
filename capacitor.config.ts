import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.mmregistro.assistentemedicacao',
  appName: 'Assistente de Medicação',
  webDir: 'native-web',
  ios: {
    // O frontend já usa viewport-fit=cover + env(safe-area-inset-*).
    // Evite que o UIScrollView do WKWebView aplique uma segunda safe area.
    contentInset: 'never',
  },
};

export default config;
