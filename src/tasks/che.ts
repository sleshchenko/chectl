/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
import { KubeHelper } from '../api/kube';
import { OpenShiftHelper } from '../api/openshift';
import { Command } from '@oclif/command'
import * as Listr from 'listr'
import { CheHelper } from '../api/che';
import { KubeTasks } from './kube';

/**
 * Holds tasks to work with Che component.
 */
export class CheTasks {
    kube: KubeHelper
    kubeTasks: KubeTasks
    oc = new OpenShiftHelper()
    che = new CheHelper()

    cheNamespace: string

    cheAccessToken: string
    cheSelector: string
    cheDeploymentName: string

    keycloakDeploymentName = 'keycloak'
    keycloakSelector = 'app=che,component=keycloak'

    postgresDeploymentName = 'postgres'
    postgresSelector = 'app=che,component=postgres'

    devfileRegistrySelector = 'app=che,component=devfile-registry'

    pluginRegistrySelector = 'app=che,component=plugin-registry'

    constructor(flags?: any) {
        this.kube = new KubeHelper(flags);
        this.kubeTasks = new KubeTasks(flags)

        if (flags.installer === 'minishift-addon') {
            this.cheSelector = 'app=che'
        } else {
            this.cheSelector = 'app=che,component=che'
        }

        this.cheAccessToken = flags['access-token']

        this.cheNamespace = flags.cheNamespace
        this.cheDeploymentName = flags['che-deployment-name']
    }

    /**
     * Returns list of tasks that checks if Che is already installed.
     * 
     * It needs the following properties to be set in context:
     * - isOpenShift
     * 
     * After executing the following properties are set in context:
     * - isCheDeployed
     * - isKeycloakDeployed
     * - isPorstgresDeployed
     * - isPluginRegistryDeployed
     * - isDevfileRegisryDeployed
     * 
     * @param command 
     */
    checkIsCheIsInstalledTasks(command: Command): ReadonlyArray<Listr.ListrTask> {
        return [
            {
                title: `Verify if deployment \"${this.cheDeploymentName}\" exists in namespace \"${this.cheNamespace}\"`,
                task: async (ctx: any, task: any) => {
                    if (ctx.isOpenShift && await this.oc.deploymentConfigExist(this.cheDeploymentName, this.cheNamespace)) {
                        // minishift addon and the openshift templates use a deployment config
                        ctx.isCheDeployed = true
                        ctx.isKeycloakDeployed = await this.oc.deploymentConfigExist(this.keycloakDeploymentName, this.cheNamespace)
                        ctx.isPorstgresDeployed = await this.oc.deploymentConfigExist(this.postgresDeploymentName, this.cheNamespace)
                        if (ctx.isKeycloakDeployed && ctx.isPorstgresDeployed) {
                            task.title = await `${task.title}...the dc "${this.cheDeploymentName}" exists (as well as keycloak and postgres)`
                        } else {
                            task.title = await `${task.title}...the dc "${this.cheDeploymentName}" exists`
                        }
                    } else if (await this.kube.deploymentExist(this.cheDeploymentName, this.cheNamespace)) {
                        // helm chart and Che operator use a deployment
                        ctx.cheDeploymentExist = true
                        ctx.isKeycloakDeployed = await this.kube.deploymentExist(this.keycloakDeploymentName, this.cheNamespace)
                        ctx.isPorstgresDeployed = await this.kube.deploymentExist(this.postgresDeploymentName, this.cheNamespace)
                        if (ctx.isKeycloakDeployed && ctx.isPorstgresDeployed) {
                            task.title = await `${task.title}...it does (as well as keycloak and postgres)`
                        } else {
                            task.title = await `${task.title}...it does`
                        }
                    } else {
                        task.title = await `${task.title}...it doesn't`
                    }
                }
            },
            {
                title: `Verify if Che server pod is running (selector "${this.cheSelector}")`,
                enabled: (ctx: any) => (ctx.cheDeploymentExist || ctx.cheDeploymentConfigExist),
                task: async (ctx: any, task: any) => {
                    const cheServerPodExist = await this.kube.podsExistBySelector(this.cheSelector as string, this.cheNamespace)
                    if (!cheServerPodExist) {
                        task.title = `${task.title}...It doesn't`
                        ctx.isStopped = true
                    } else {
                        const cheServerPodReadyStatus = await this.kube.getPodReadyConditionStatus(this.cheSelector as string, this.cheNamespace)
                        if (cheServerPodReadyStatus !== 'True') {
                            task.title = `${task.title}...It doesn't`
                            ctx.isNotReadyYet = true
                        } else {
                            task.title = `${task.title}...it does.`
                        }
                    }
                }
            },
            {
                title: 'Check Che server status',
                enabled: (ctx: any) => ctx.isCheDeployed && !ctx.isStopped && !ctx.isNotReadyYet,
                task: async (ctx: any, task: any) => {
                    let cheURL = ''
                    try {
                        cheURL = await this.che.cheURL(this.cheNamespace)
                        const status = await this.che.getCheServerStatus(cheURL)
                        ctx.isAuthEnabled = await this.che.isAuthenticationEnabled(cheURL)
                        const auth = ctx.isAuthEnabled ? '(auth enabled)' : '(auth disabled)'
                        task.title = await `${task.title}...${status} ${auth}`
                    } catch (error) {
                        command.error(`E_CHECK_CHE_STATUS_FAIL - Failed to check Che status (URL: ${cheURL}). ${error.message}`)
                    }
                }
            }
        ]
    }

    /**
     * Scale Che down. 
     * It requires {@link #checkIsCheIsInstalledTasks} to be executed before.
     * @param command 
     */
    scaleCheDownTasks(command: Command) {
        return [{
            title: 'Stop Che server and wait until it\'s ready to shutdown',
            enabled: (ctx: any) => !ctx.isStopped && !ctx.isNotReadyYet,
            task: async (ctx: any, task: any) => {
              if (ctx.isAuthEnabled && !this.cheAccessToken) {
                command.error('E_AUTH_REQUIRED - Che authentication is enabled and an access token need to be provided (flag --access-token).\nFor instructions to retreive a valid access token refer to https://www.eclipse.org/che/docs/che-6/authentication.html')
              }
              try {
                const cheURL = await this.che.cheURL(this.cheNamespace)
                await this.che.startShutdown(cheURL, this.cheAccessToken)
                await this.che.waitUntilReadyToShutdown(cheURL)
                task.title = await `${task.title}...done`
              } catch (error) {
                command.error(`E_SHUTDOWN_CHE_SERVER_FAIL - Failed to shutdown Che server. ${error.message}`)
              }
            }
          },
          {
            title: `Scale  \"${this.cheDeploymentName}\"  deployment to zero`,
            enabled: (ctx: any) => !ctx.isStopped,
            task: async (ctx: any, task: any) => {
              try {
                if (ctx.cheDeploymentConfigExist) {
                  await this.oc.scaleDeploymentConfig(this.cheDeploymentName, this.cheNamespace, 0)
                } else {
                  await this.kube.scaleDeployment(this.cheDeploymentName, this.cheNamespace, 0)
                }
                task.title = await `${task.title}...done`
              } catch (error) {
                command.error(`E_SCALE_DEPLOY_FAIL - Failed to scale deployment. ${error.message}`)
              }
            }
          },
          {
            title: 'Wait until Che pod is deleted',
            enabled: (ctx: any) => !ctx.isStopped,
            task: async (_ctx: any, task: any) => {
              await this.kube.waitUntilPodIsDeleted('app=che', this.cheNamespace)
              task.title = `${task.title}...done.`
            }
          },
          {
            title: 'Scale  \"keycloak\"  deployment to zero',
            enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
            task: async (ctx: any, task: any) => {
              try {
                if (ctx.cheDeploymentConfigExist) {
                  await this.oc.scaleDeploymentConfig('keycloak', this.cheNamespace, 0)
                } else {
                  await this.kube.scaleDeployment('keycloak', this.cheNamespace, 0)
                }
                task.title = await `${task.title}...done`
              } catch (error) {
                command.error(`E_SCALE_DEPLOY_FAIL - Failed to scale keycloak deployment. ${error.message}`)
              }
            }
          },
          {
            title: 'Wait until Keycloak pod is deleted',
            enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
            task: async (_ctx: any, task: any) => {
              await this.kube.waitUntilPodIsDeleted('app=keycloak', this.cheNamespace)
              task.title = `${task.title}...done.`
            }
          },
          {
            title: 'Scale  \"postgres\"  deployment to zero',
            enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
            task: async (ctx: any, task: any) => {
              try {
                if (ctx.cheDeploymentConfigExist) {
                  await this.oc.scaleDeploymentConfig('postgres', this.cheNamespace, 0)
                } else {
                  await this.kube.scaleDeployment('postgres', this.cheNamespace, 0)
                }
                task.title = await `${task.title}...done`
              } catch (error) {
                command.error(`E_SCALE_DEPLOY_FAIL - Failed to scale postgres deployment. ${error.message}`)
              }
            }
          },
          {
            title: 'Wait until Postgres pod is deleted',
            enabled: (ctx: any) => !ctx.isStopped && ctx.keycloakDeploymentExist,
            task: async (_ctx: any, task: any) => {
              await this.kube.waitUntilPodIsDeleted('app=postgres', this.cheNamespace)
              task.title = `${task.title}...done.`
            }
          },
          {
            title: 'Scale  \"devfile registry\"  deployment to zero',
            enabled: (ctx: any) => ctx.foundDevfileRegistryDeployment,
            task: async (ctx: any, task: any) => {
              try {
                if (ctx.deploymentConfigExist) {
                  await this.oc.scaleDeploymentConfig('devfile-registry', this.cheNamespace, 0)
                } else {
                  await this.kube.scaleDeployment('devfile-registry', this.cheNamespace, 0)
                }
                task.title = await `${task.title}...done`
              } catch (error) {
                command.error(`E_SCALE_DEPLOY_FAIL - Failed to scale devfile-registry deployment. ${error.message}`)
              }
            }
          },
          {
            title: 'Wait until Devfile registry pod is deleted',
            enabled: (ctx: any) => ctx.foundDevfileRegistryDeployment,
            task: async (_ctx: any, task: any) => {
              await this.kube.waitUntilPodIsDeleted('app=che,component=devfile-registry', this.cheNamespace)
              task.title = `${task.title}...done.`
            }
          },
          {
            title: 'Scale  \"plugin registry\"  deployment to zero',
            enabled: (ctx: any) => ctx.foundPluginRegistryDeployment,
            task: async (ctx: any, task: any) => {
              try {
                if (ctx.deploymentConfigExist) {
                  await this.oc.scaleDeploymentConfig('plugin-registry', this.cheNamespace, 0)
                } else {
                  await this.kube.scaleDeployment('plugin-registry', this.cheNamespace, 0)
                }
                task.title = await `${task.title}...done`
              } catch (error) {
                command.error(`E_SCALE_DEPLOY_FAIL - Failed to scale plugin-registry deployment. ${error.message}`)
              }
            }
          },
          {
            title: 'Wait until Plugin registry pod is deleted',
            enabled: (ctx: any) => ctx.foundPluginRegistryDeployment,
            task: async (_ctx: any, task: any) => {
              await this.kube.waitUntilPodIsDeleted('app=che,component=plugin-registry', this.cheNamespace)
              task.title = `${task.title}...done.`
            }
          }]
      }

    /**
     * 
     * @param command 
     */
    scaleCheUpTasks(command: Command):  ReadonlyArray<Listr.ListrTask>  {
        return [
            {
              title: 'Scaling up Che Deployment',
              enabled: (ctx: any) => ctx.cheDeploymentExist && ctx.isStopped,
              task: async (ctx: any, task: any) => {
                if (ctx.postgresDeploymentExist) {
                  await this.kube.scaleDeployment('postgres', this.cheNamespace, 1)
                }
                if (ctx.keycloakDeploymentExist) {
                  await this.kube.scaleDeployment('keycloak', this.cheNamespace, 1)
                }
                await this.kube.scaleDeployment(this.cheDeploymentName, this.cheNamespace, 1)
                task.title = `${task.title}...done.`
              }
            },
            {
              title: 'Scaling up Che DeploymentConfig',
              enabled: (ctx: any) => ctx.cheDeploymentConfigExist && ctx.isStopped,
              task: async (ctx: any, task: any) => {
                if (ctx.postgresDeploymentExist) {
                  await this.oc.scaleDeploymentConfig('postgres', this.cheNamespace, 1)
                }
                if (ctx.keycloakDeploymentExist) {
                  await this.oc.scaleDeploymentConfig('keycloak', this.cheNamespace, 1)
                }
                await this.oc.scaleDeploymentConfig(this.cheDeploymentName, this.cheNamespace, 1)
                task.title = `${task.title}...done.`
              }
            },
            {
              title: `Che is already running in namespace \"${this.cheNamespace}\".`,
              enabled: (ctx: any) => (ctx.isCheDeployed && !ctx.isStopped),
              task: async (ctx: any, task: any) => {
                ctx.cheDeploymentExist = true
                ctx.cheIsAlreadyRunning = true
                ctx.cheURL = await this.che.cheURL(this.cheNamespace)
                task.title = await `${task.title}...it's URL is ${ctx.cheURL}`
              }
            }
          ]
      }

    waitChePodTasks(command: Command): Listr {
        return this.kubeTasks.podStartTasks(command, this.cheSelector, this.cheNamespace)
    }

    waitKeycloakPodTasks(command: Command): Listr {
        return this.kubeTasks.podStartTasks(command, this.keycloakSelector, this.cheNamespace)
    }

    waitPostgresPodTasks(command: Command): Listr {
        return this.kubeTasks.podStartTasks(command, this.postgresSelector, this.cheNamespace)
    }

    waitPluginRegistryPodTasks(command: Command): Listr {
        return this.kubeTasks.podStartTasks(command, this.pluginRegistrySelector, this.cheNamespace)
    }

    waitDevfileRegistryPodTasks(command: Command): Listr {
        return this.kubeTasks.podStartTasks(command, this.devfileRegistrySelector, this.cheNamespace)
    }
}