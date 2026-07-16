interface Config {
    PORT: number;
    HOST: string;
    DATA_DIR: string;
    LOG_LEVEL: string;
    ENABLE_ADMIN: boolean;
}

function getEnv(key: string, defaultValue: string): string {
    const value = process.env[key];
    if (!value && defaultValue === undefined) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value || defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;
    const num = parseInt(value, 10);
    if (isNaN(num)) {
        throw new Error(`Invalid number for environment variable ${key}: ${value}`);
    }
    return num;
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return value === 'true' || value === '1' || value === 'yes';
}

export function loadConfig(): Config {
    return {
        PORT: getEnvNumber('PORT', 3000),
        HOST: getEnv('HOST', '0.0.0.0'),
        DATA_DIR: getEnv('DATA_DIR', './data'),
        LOG_LEVEL: getEnv('LOG_LEVEL', 'info'),
        ENABLE_ADMIN: getEnvBool('ENABLE_ADMIN', true),
    };
}
