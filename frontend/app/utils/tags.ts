export const parseTagString = (value: string): string[] =>
    value
        ? value
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
        : [];
