import 'package:flutter/material.dart';

/// Tema oscuro con el color de la marca, como el escritorio y la web.
class AppColors {
  static const accent = Color(0xFF6366F1);
  static const accentSoft = Color(0xFF818CF8);
  static const background = Color(0xFF121214);
  static const surface = Color(0xFF18181B);
  static const surfaceHigh = Color(0xFF27272A);
  static const border = Color(0x14FFFFFF);
  static const textSecondary = Color(0xFFA1A1AA);
  static const textMuted = Color(0xFF71717A);
  static const warning = Color(0xFFEAB308);
  static const danger = Color(0xFFEF4444);
  static const success = Color(0xFF22C55E);
  static const folder = Color(0xFFFBBF24);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: AppColors.accent, brightness: Brightness.dark).copyWith(
    primary: AppColors.accent,
    onPrimary: Colors.white,
    surface: AppColors.background,
    surfaceContainerLowest: AppColors.background,
    surfaceContainerLow: AppColors.surface,
    surfaceContainer: AppColors.surface,
    surfaceContainerHigh: AppColors.surfaceHigh,
    error: AppColors.danger,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: AppColors.background,
    appBarTheme: const AppBarTheme(backgroundColor: AppColors.surface, surfaceTintColor: Colors.transparent, centerTitle: false),
    dividerTheme: const DividerThemeData(color: AppColors.border, space: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.background,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0x24FFFFFF))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.accent, width: 1.5)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size(0, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(backgroundColor: AppColors.accent, foregroundColor: Colors.white),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? AppColors.accent : Colors.transparent),
        foregroundColor: WidgetStateProperty.resolveWith((states) => states.contains(WidgetState.selected) ? Colors.white : AppColors.textSecondary),
      ),
    ),
  );
}
