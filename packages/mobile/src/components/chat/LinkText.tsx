import React, { useMemo } from 'react';
import { Text, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { splitLinks } from '../../utils/links';

interface LinkTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Message text with its web links underlined. The tap that opens a link
 * belongs to the whole bubble (ChatScreen), not to the underlined run:
 * a press on nested text is not reliable on Android's new architecture,
 * and a bubble is a far bigger target anyway. The link keeps the
 * surrounding text's colour, so it reads the same in both bubbles.
 */
export const LinkText: React.FC<LinkTextProps> = React.memo(({ text, style }) => {
  const parts = useMemo(() => splitLinks(text), [text]);

  if (parts.length === 1 && !parts[0].url) {
    return <Text style={style}>{text}</Text>;
  }

  return (
    <Text style={style}>
      {parts.map((part, i) =>
        part.url ? (
          <Text key={i} style={styles.link}>
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
