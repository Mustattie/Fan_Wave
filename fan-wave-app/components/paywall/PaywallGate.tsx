import React, { useState, useCallback } from 'react';
import { TouchableOpacity, ViewStyle, GestureResponderEvent } from 'react-native';
import { useHasTierOrHigher, useHasWCAccess, type SubscriptionTier } from '@/lib/entitlements';
import { PremiumPaywall } from './PremiumPaywall';
import { WCPassPaywall } from './WCPassPaywall';

// v9.3 tier-aware requirement. 'premium' is a back-compat alias for
// 'home_team' so legacy callers keep working; new callers should use
// the explicit tier name.
type Requirement = 'home_team' | 'mvp' | 'business' | 'premium' | 'wc_pass';

interface Props {
  require: Requirement;
  children: React.ReactElement<{ onPress?: (e: GestureResponderEvent) => void; disabled?: boolean }>;
  style?: ViewStyle;
}

function normalizeTier(req: Requirement): SubscriptionTier | 'wc_pass' {
  if (req === 'premium') return 'home_team';
  if (req === 'wc_pass') return 'wc_pass';
  return req;
}

/**
 * Wraps a CTA element (TouchableOpacity, Button, etc.) and intercepts taps
 * when the current user doesn't have the required entitlement. On a blocked
 * tap, opens the appropriate paywall sheet instead of the wrapped action.
 *
 * Usage:
 *   <PaywallGate require="home_team">
 *     <TouchableOpacity onPress={createPrivateWatchParty}>...</TouchableOpacity>
 *   </PaywallGate>
 *
 * The wrapped child's onPress fires normally when entitled.
 */
export function PaywallGate({ require, children, style }: Props) {
  const normalized = normalizeTier(require);
  const isWcRequirement = normalized === 'wc_pass';
  const requiredTier = (isWcRequirement ? 'home_team' : normalized) as SubscriptionTier;

  const hasTier = useHasTierOrHigher(requiredTier);
  const hasWCAccess = useHasWCAccess();
  const [showPaywall, setShowPaywall] = useState(false);

  const isEntitled = isWcRequirement ? hasWCAccess : hasTier;
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
      {isWcRequirement ? (
        <WCPassPaywall
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />
      ) : (
        <PremiumPaywall
          tier={requiredTier === 'mvp' ? 'mvp' : 'home_team'}
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </>
  );
}
