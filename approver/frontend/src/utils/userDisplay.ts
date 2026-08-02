export interface UserDisplayShape {
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    email?: string | null;
}

const normalize = (value?: string | null): string => {
    return typeof value === 'string' ? value.trim() : '';
};

export const getUserFullName = (user?: UserDisplayShape | null): string => {
    const firstName = normalize(user?.firstName);
    const lastName = normalize(user?.lastName);
    return [firstName, lastName].filter(Boolean).join(' ');
};

export const getUserDisplayName = (
    user?: UserDisplayShape | null,
    fallback = 'Unknown'
): string => {
    return getUserFullName(user) || normalize(user?.username) || normalize(user?.email) || fallback;
};

export const getUserInitials = (
    user?: UserDisplayShape | null,
    fallback = '?'
): string => {
    const fullName = getUserFullName(user);
    if (fullName) {
        const parts = fullName.split(/\s+/).filter(Boolean);
        const first = parts[0]?.[0] || '';
        const second = parts[1]?.[0] || '';
        return `${first}${second}`.toUpperCase() || fallback;
    }

    const username = normalize(user?.username);
    if (username) {
        return username.charAt(0).toUpperCase();
    }

    const email = normalize(user?.email);
    if (email) {
        return email.charAt(0).toUpperCase();
    }

    return fallback;
};

export const hasCompletedNameProfile = (user?: UserDisplayShape | null): boolean => {
    return Boolean(normalize(user?.firstName) && normalize(user?.lastName));
};
