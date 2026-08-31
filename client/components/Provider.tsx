import { AuthProvider } from '@/contexts/AuthContext';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { WebOnlyPrettyScrollbar } from './PrettyScrollbar'
import { NotificationLifecycle } from './NotificationLifecycle';
import { ShareLinkLifecycle } from './ShareLinkLifecycle';
import { ServerStateProvider } from './ServerStateProvider';

function Provider({ children }: { children: ReactNode }) {
  return <WebOnlyPrettyScrollbar>
      <ServerStateProvider>
        <AuthProvider>
          <View style={{ flex: 1 }}>
            <NotificationLifecycle />
            <ShareLinkLifecycle />
            {children}
          </View>
        </AuthProvider>
      </ServerStateProvider>
    </WebOnlyPrettyScrollbar>
}

export {
  Provider,
}
