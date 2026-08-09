import { AuthProvider } from '@/contexts/AuthContext';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { WebOnlyColorSchemeUpdater } from './ColorSchemeUpdater';
import { WebOnlyPrettyScrollbar } from './PrettyScrollbar'
import { NotificationLifecycle } from './NotificationLifecycle';

function Provider({ children }: { children: ReactNode }) {
  return <WebOnlyColorSchemeUpdater>
    <WebOnlyPrettyScrollbar>
      <AuthProvider>
        <View style={{ flex: 1 }}>
          <NotificationLifecycle />
          {children}
        </View>
      </AuthProvider>
    </WebOnlyPrettyScrollbar>
  </WebOnlyColorSchemeUpdater>
}

export {
  Provider,
}
