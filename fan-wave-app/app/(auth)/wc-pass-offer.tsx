import React from 'react';
import { Redirect } from 'expo-router';

// Keep old links working without offering the retired tournament purchase.
export default function WCPassOfferScreen() {
  return <Redirect href="/(tabs)/game-day" />;
}
