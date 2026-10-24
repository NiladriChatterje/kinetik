import React, { useCallback, useMemo } from 'react';
import { Text, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { splitLinks, openLink } from '../../utils/links';
import { useToast } from '../../hooks/useToast';

interface LinkTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Message text with its web links underlined and tappable. A tap hands the
 * link to the system, which opens the app that owns it when installed and
 * the browser otherwise. The link keeps the surrounding text's colour, so
 * it reads the same in both bubbles.
 */
export const LinkText: React.FC<LinkTextProps> = React.memo(({ text, style }) => {
  const toast = useToast();
  const parts = useMemo(() => splitLinks(text), [text]);

  const open = useCallback(async (url: string) => {
    const ok = await openLink(url);
    if (!ok) toast.showError("Couldn't open link", 'No app on this phone can open it.');
  }, [toast]);

  if (parts.length === 1 && !parts[0].url) {
    return <Text style={style}>{text}</Text>;
  }

  return (
    <Text style={style}>
      {parts.map((part, i) =>
        part.url ? (
          <Text
            key={i}
            style={styles.link}
            onPress={() => open(part.url as string)}
            accessibilityRole="link"
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
});
LinkText.displayName = 'LinkText';

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline' },
});
