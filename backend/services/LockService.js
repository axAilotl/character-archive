
class LockService {
    constructor() {
        this.syncInProgress = false;
        this.ctSyncInProgress = false;
    }

    isSyncInProgress() {
        return this.syncInProgress;
    }

    setSyncInProgress(value) {
        this.syncInProgress = !!value;
    }

    isCtSyncInProgress() {
        return this.ctSyncInProgress;
    }

    setCtSyncInProgress(value) {
        this.ctSyncInProgress = !!value;
    }
}

export const lockService = new LockService();
