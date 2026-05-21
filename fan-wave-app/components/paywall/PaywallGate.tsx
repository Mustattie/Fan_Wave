import React, { useState, useCallback } from 'react';
import { TouchableOpacity, ViewStyle, GestureResponderEvent } from 'react-native';
import { useHasPremium, useHasWCAccess } from '@/lib/entitlements';
import { PremiumPaywall } from './PremiumPaywall';
import { WCPassPaywall } from './WCPassPaywall';

type Requirement = 'premium' | 'wc_pass';

interface Props {
  require: Requirement;
  children: React.ReactElement<{ onPress?: (e: GestureResponderEvent) => void; disabled?: boolean }>;
  style?: ViewStyle;
}

/**
 * Wraps a CTA element (TouchableOpacity, Button, etc.) and intercepts taps
 * when the current user doesn't have the required entitlement. On a blocked
 * tap, opens the appropriate paywall sheet instead of the wrapped action.
 *
 * Usage:
 *   <PaywallGate require="premium">
 *     <TouchableOpacity onPress={postClip}>...</TouchableOpacity>
 *   </PaywallGate>
 *
 * The wrapped child's onPress fires normally when entitled.
 */
export function PaywallGate({ require, children, style }: Props) {
  const hasPremium = useHasPremium();
  const hasWCAccess = useHasWCAccess();
  const [showPaywall, setShowPaywall] = useState(false);

  const isEntitled = require === 'premium' ? hasPremium : hasWCAccess;
  const childOriginalOnPress = children.props.onPress;

  const handleInterceptedPress = useCallback(
    (e: GestureResponderEvent) => {
      if (isEntitled) {
        childOriginalOnPress?.(e);
      } else {
        setShowPaywall(true);
      }
    },
    [isEntitled, childOriginalOnPress],
  );

  // Clone the child with our interceptor onPress
  const guardedChild = React.cloneElement(children, {
    onPress: handleInterceptedPress,
  });

  return (
    <>
      {style ? (
        // If a style was provided, wrap in a View for layout consistency
        <TouchableOpacity activeOpacity={1} style={style} onPress={handleInterceptedPress}>
          {React.cloneElement(children, { onPress: undefined })}
        </TouchableOpacity>
      ) : (
        guardedChild
      )}
      {require === 'premium' ? (
        <PremiumPaywall
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />
      ) : (
        <WCPassPaywall
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </>
  );
}
