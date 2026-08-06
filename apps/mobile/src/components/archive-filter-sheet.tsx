import { Pressable, StyleSheet, View } from 'react-native';

import {
  arcanaLabels,
  datePresetLabels,
  defaultArchiveFilterSelection,
  intentionLabels,
  orientationLabels,
  suitLabels,
  type ArchiveFilterSelection,
} from '@/fortune/archive-filters';
import { colors, layout, radii, spacing } from '@/theme/tokens';

import { AdaptiveSheet } from './adaptive-sheet';
import { AppButton } from './app-button';
import { AppText } from './app-text';

interface ArchiveFilterSheetProps {
  onChange: (selection: ArchiveFilterSelection) => void;
  onClose: () => void;
  selection: ArchiveFilterSelection;
  visible: boolean;
}

interface FilterOption<Value extends string> {
  label: string;
  value: Value;
}

function optionsFrom<Value extends string>(labels: Record<Value, string>): FilterOption<Value>[] {
  return (Object.entries(labels) as [Value, string][]).map(([value, label]) => ({ label, value }));
}

type FacetKey = 'arcana' | 'intention' | 'orientation' | 'suit';

function setFacet<Key extends FacetKey>(
  selection: ArchiveFilterSelection,
  key: Key,
  value: ArchiveFilterSelection[Key] | undefined,
): ArchiveFilterSelection {
  const next: ArchiveFilterSelection = { datePreset: selection.datePreset };
  if (selection.arcana !== undefined && key !== 'arcana') {
    next.arcana = selection.arcana;
  }
  if (selection.intention !== undefined && key !== 'intention') {
    next.intention = selection.intention;
  }
  if (selection.orientation !== undefined && key !== 'orientation') {
    next.orientation = selection.orientation;
  }
  if (selection.suit !== undefined && key !== 'suit') {
    next.suit = selection.suit;
  }
  if (value !== undefined) {
    next[key] = value;
  }
  return next;
}

function FilterGroup<Value extends string>({
  label,
  onSelect,
  options,
  selected,
}: {
  label: string;
  onSelect: (value: Value | undefined) => void;
  options: FilterOption<Value>[];
  selected: Value | undefined;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.group}>
      <AppText color="textMuted" variant="label">
        {label}
      </AppText>
      <View style={styles.options}>
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <Pressable
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              key={option.value}
              onPress={() => {
                onSelect(isSelected ? undefined : option.value);
              }}
              style={[styles.option, isSelected ? styles.optionSelected : undefined]}
            >
              <AppText color={isSelected ? 'text' : 'textMuted'} variant="label">
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ArchiveFilterSheet({
  onChange,
  onClose,
  selection,
  visible,
}: ArchiveFilterSheetProps) {
  return (
    <AdaptiveSheet onClose={onClose} title="Filter readings" visible={visible}>
      <FilterGroup
        label="Intention"
        onSelect={(intention) => {
          onChange(setFacet(selection, 'intention', intention));
        }}
        options={optionsFrom(intentionLabels)}
        selected={selection.intention}
      />
      <FilterGroup
        label="Orientation"
        onSelect={(orientation) => {
          onChange(setFacet(selection, 'orientation', orientation));
        }}
        options={optionsFrom(orientationLabels)}
        selected={selection.orientation}
      />
      <FilterGroup
        label="Arcana"
        onSelect={(arcana) => {
          onChange(setFacet(selection, 'arcana', arcana));
        }}
        options={optionsFrom(arcanaLabels)}
        selected={selection.arcana}
      />
      <FilterGroup
        label="Suit"
        onSelect={(suit) => {
          onChange(setFacet(selection, 'suit', suit));
        }}
        options={optionsFrom(suitLabels)}
        selected={selection.suit}
      />
      <FilterGroup
        label="Date"
        onSelect={(datePreset) => {
          onChange({ ...selection, datePreset: datePreset ?? 'all' });
        }}
        options={optionsFrom(datePresetLabels)}
        selected={selection.datePreset}
      />
      <View style={styles.actions}>
        <AppButton
          label="Clear filters"
          onPress={() => {
            onChange(defaultArchiveFilterSelection);
          }}
          variant="quiet"
        />
        <AppButton label="Done" onPress={onClose} variant="primary" />
      </View>
    </AdaptiveSheet>
  );
}

const styles = StyleSheet.create({
  group: {
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  option: {
    minHeight: layout.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceRaised,
  },
  optionSelected: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.goldMuted,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
