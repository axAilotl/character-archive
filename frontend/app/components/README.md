# Component Extraction

Components extracted from the monolithic page.tsx to improve maintainability.

## Extracted Components

- **TagMultiSelect.tsx**: Tag selection with autocomplete and canonical tag highlighting
- **CardModal.tsx**: Card details modal with metadata, gallery, and actions (WIP)
- **SettingsModal.tsx**: Settings configuration modal (WIP)

Each component is self-contained with its own props interface and handles its own local state.
State and callbacks are passed down from the parent page component.
