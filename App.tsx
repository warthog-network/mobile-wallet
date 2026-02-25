// App.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, StatusBar } from 'react-native';
import Wallet from './Wallet';   // ← we'll create this file next
import { SvgXml } from 'react-native-svg';

const svgContent = `<?xml version="1.0" encoding="utf-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 viewBox="0 0 754 280">

<g id="Layer_1">
</g>
<g id="Layer_2">
	<g>
		<path fill="#FFC107" d="M240.6,230.1L239.8,128l-45.7,102.2h-63.3V49.9h53.9l-1.1,110.3l51.6-110.3h41.1l3,110.3l47.3-110.3h68.5
			l-97.2,180.3H240.6z"/>
		<g>
			<polygon fill="#FFC107" points="401.3,229.8 432.6,230.1 461.9,192.4 426.3,206 			"/>
			<g>
				<path fill="#FFC107" d="M590.7,148.8l25.2-5.5l7.3-16.4l-9.8-2.3l-25.5-17.6l-19.4-32l-8.2,2.4l-7.9-22.9L533.7,69l2.3-13.1
					l-33.9-6.1l11.2,9.7l-40.7-5l15.6,11L446.6,66l19.3,9.9l-36.6,8l19.1,4.8l-22.9,7.4l-0.7,0l-0.5,0.4l-16.3,5.2l6.6,1.3
					L399,113.6l0-0.1l-15.6,9.9l-7.4,16.5l-13.4,6.9l2.3,6.5l17.4-4.8l9.8,9.8l0.7,27.8l-25.9,44.2H390l34.1-32l44.6-15.7l45.7-22.7
					l46.9,11.2l9.1,18.9l23-10.9l-11.2-20l-28.1-19l5.3-2.6L590.7,148.8z M574.5,99.5l3.7,9.4l-14.2-6.4L574.5,99.5z"/>
				<polygon fill="#FFC107" points="513.2,166.8 502.8,172.8 534.2,187 542.7,201.8 562.2,192.4 554.9,178.4 				"/>
			</g>
		</g>
	</g>
</g>
</svg>`;

export default function App() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    // We'll connect real refresh later
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#070707" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#FFC107']}
            tintColor="#FFC107"
          />
        }
      >
        <View style={styles.header}>
          <SvgXml xml={svgContent} width={300} height={111} />
          <Text style={styles.title}>WARTHOG WALLET</Text>
          <Text style={styles.subtitle}>Android + iOS • Production Ready</Text>
        </View>

        {/* This is where your full wallet will live */}
        <Wallet />

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070707',
  },
  scrollContent: {
    padding: 7,
    minHeight: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
    paddingTop: 7,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFC107',
    textShadowColor: '#000',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#FFECB3',
    marginTop: 8,
    fontWeight: '500',
  },
});
