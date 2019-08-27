
export declare namespace CheContext {
  interface CheContext {
    isOpenShift: boolean, 
    status: CheStatus,
    [key: string]:any
  }
  
  interface CheStatus {
    cheServer: ServerStatus,
    postgres: ServerStatus,
    keycloak: ServerStatus,
    pluginRegistry: ServerStatus,
    devfileRegistry: ServerStatus
  }

  interface ServerStatus {
    isDeployed: boolean,
    isRun: boolean,
    isReady: boolean
  }  
}

export const initCtx: CheContext.CheContext = {
    isOpenShift: false,
    status: {
      cheServer: {
        isDeployed: false,
        isReady: false,
        isRun: false,
      },
      keycloak: {
        isDeployed: false,
        isReady: false,
        isRun: false,
      },
      postgres: {
        isDeployed: false,
        isReady: false,
        isRun: false,
      },
      pluginRegistry: {
        isDeployed: false,
        isReady: false,
        isRun: false,
      },
      devfileRegistry: {
        isDeployed: false,
        isReady: false,
        isRun: false,
      }
    }
  }