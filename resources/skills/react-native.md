---
name: React Native
description: Mobile apps with React Native and Expo
tags: mobile, react-native
---
- Check whether the project uses Expo or bare React Native and use its tools to add native modules.
- Use `FlatList`/`SectionList` for long lists, never a mapped `ScrollView`.
- Style with `StyleSheet.create` or the project's styling library; test on small and large screens.
- Handle safe areas, the keyboard, and both iOS and Android back behaviour.
- Give touchable elements an `accessibilityLabel` and a target of at least 44×44 points.
- Keep secrets off the device; the app bundle is readable.
