import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Edge = 'top' | 'right' | 'bottom' | 'left';

interface Props {
  children: React.ReactNode;
  /**
   * Sticky header rendered above the scroll area. Sits outside the
   * KeyboardAvoidingView so it doesn't shift when the keyboard opens.
   */
  header?: React.ReactNode;
  /**
   * Sticky footer (typically the primary CTA). Sits INSIDE the
   * KeyboardAvoidingView so it rides above the keyboard on iOS, and
   * gets `paddingBottom: insets.bottom` so it's never cut off by the
   * Android system nav bar / iPhone home indicator when the keyboard
   * is closed.
   */
  footer?: React.ReactNode;
  /**
   * Edges to apply safe-area insets to. Default: ['top'] (the footer
   * already handles bottom via insets.bottom; top guards the header
   * against the status bar / notch).
   */
  edges?: readonly Edge[];
  /**
   * Whether the body content is scrollable. Default: true. Set false
   * for screens whose body is its own list (FlatList, etc.).
   */
  scrollable?: boolean;
  /** Optional style applied to the outer SafeAreaView. */
  style?: StyleProp<ViewStyle>;
  /** Optional style for the inner ScrollView contentContainer. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Extra padding above the footer when keyboard is closed. Default: 12. */
  footerExtraPadding?: number;
}

/**
 * Single source of truth for keyboard + safe-area handling on any screen
 * with TextInputs and a sticky bottom CTA. Eliminates the per-screen mix
 * of KeyboardAvoidingView, useKeyboardHeight() hacks, and ad-hoc
 * paddingBottom: insets.bottom calls.
 *
 * Pattern:
 *
 *   <KeyboardAwareScreen
 *     header={<MyHeader />}
 *     footer={<MyCreateButton />}
 *   >
 *     <Text>...</Text>
 *     <TextInput ... />
 *     <TextInput ... />
 *   </KeyboardAwareScreen>
 *
 * On Android, behavior="height" causes the form to resize; on iOS,
 * behavior="padding" pads the bottom equal to the keyboard. Both
 * approaches keep the focused TextInput visible without per-screen
 * tweaks.
 */
export function KeyboardAwareScreen({
  children,
  header,
  footer,
  edges = ['top'],
  scrollable = true,
  style,
  contentContainerStyle,
  footerExtraPadding = 12,
}: Props) {
  const insets = useSafeAreaInsets();

  const body = scrollable ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );

  const safeFooter = footer ? (
    <View
      style={{
        paddingBottom: insets.bottom + footerExtraPadding,
        paddingTop: 8,
        paddingHorizontal: 16,
      }}
    >
      {footer}
    </View>
  ) : null;

  return (
    <SafeAreaView style={[{ flex: 1 }, style]} edges={edges}>
      {header}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        // Header sits outside KAV; no offset needed.
        keyboardVerticalOffset={0}
      >
        {body}
        {safeFooter}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
