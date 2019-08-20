/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/
// tslint:disable:object-curly-spacing

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'
import * as fs from 'fs-extra'
import * as Listr from 'listr'
import * as notifier from 'node-notifier'
import * as path from 'path'

import { CheHelper } from '../../api/che'
import { KubeHelper } from '../../api/kube'
import { OpenShiftHelper } from '../../api/openshift'
import { HelmHelper } from '../../installers/helm'
import { MinishiftAddonHelper } from '../../installers/minishift-addon'
import { OperatorHelper } from '../../installers/operator'
import { DockerDesktopHelper } from '../../platforms/docker-desktop'
import { K8sHelper } from '../../platforms/k8s'
import { MicroK8sHelper } from '../../platforms/microk8s'
import { MinikubeHelper } from '../../platforms/minikube'
import { MinishiftHelper } from '../../platforms/minishift'
import { OpenshiftHelper as OpenShiftPlatform } from '../../platforms/openshift'

let kube: KubeHelper
export default class Start extends Command {
  static description = 'start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: string({
      char: 'n',
      description: 'Kubernetes namespace where Che resources will be deployed',
      default: 'che',
      env: 'CHE_NAMESPACE'
    }),
    cheimage: string({
      char: 'i',
      description: 'Che server container image',
      default: 'eclipse/che-server:nightly',
      env: 'CHE_CONTAINER_IMAGE'
    }),
    templates: string({
      char: 't',
      description: 'Path to the templates folder',
      default: Start.getTemplatesDir(),
      env: 'CHE_TEMPLATES_FOLDER'
    }),
    'devfile-registry-url': string({
      description: 'The URL of the external Devfile registry.',
      env: 'CHE_WORKSPACE_DEVFILE__REGISTRY__URL'
    }),
    'plugin-registry-url': string({
      description: 'The URL of the external plugin registry.',
      env: 'CHE_WORKSPACE_PLUGIN__REGISTRY__URL'
    }),
    cheboottimeout: string({
      char: 'o',
      description: 'Che server bootstrap timeout (in milliseconds)',
      default: '40000',
      required: true,
      env: 'CHE_SERVER_BOOT_TIMEOUT'
    }),
    k8spodwaittimeout: string({
      description: 'Waiting time for Pod Wait Timeout Kubernetes (in milliseconds)',
      default: '300000'
    }),
    k8spodreadytimeout: string({
      description: 'Waiting time for Pod Ready Kubernetes (in milliseconds)',
      default: '130000'
    }),
    'listr-renderer': string({
      description: 'Listr renderer. Can be \'default\', \'silent\' or \'verbose\'',
      default: 'default'
    }),
    'deployment-name': string({
      description: 'Che deployment name',
      default: 'che',
      env: 'CHE_DEPLOYMENT'
    }),
    multiuser: flags.boolean({
      char: 'm',
      description: 'Starts che in multi-user mode',
      default: false
    }),
    'che-selector': string({
      description: 'Selector for Che Server resources',
      default: 'app=che,component=che',
      env: 'CHE_SELECTOR'
    }),
    tls: flags.boolean({
      char: 's',
      description: 'Enable TLS encryption. Note that `che-tls` secret with TLS certificate must be created in the configured namespace.',
      default: false
    }),
    'self-signed-cert': flags.boolean({
      description: 'Authorize usage of self signed certificates for encryption. Note that `self-signed-cert` secret with CA certificate must be created in the configured namespace.',
      default: false
    }),
    installer: string({
      char: 'a',
      description: 'Installer type. Valid values are \"helm\", \"operator\" and \"minishift-addon\"',
      default: ''
    }),
    domain: string({
      char: 'b',
      description: 'Domain of the Kubernetes cluster (e.g. example.k8s-cluster.com or <local-ip>.nip.io)',
      default: ''
    }),
    platform: string({
      char: 'p',
      description: 'Type of Kubernetes platform. Valid values are \"minikube\", \"minishift\", \"k8s\", \"openshift\", \"microk8s\".',
      default: 'minikube'
    }),
    'os-oauth': flags.boolean({
      description: 'Enable use of OpenShift credentials to log into Che',
      default: false
    }),
    'che-operator-image': string({
      description: 'Container image of the operator. This parameter is used only when the installer is the operator',
      default: 'quay.io/eclipse/che-operator:nightly'
    }),
    'che-operator-cr-yaml': string({
      description: 'Path to a yaml file that defines a CheCluster used by the operator. This parameter is used only when the installer is the operator.',
      default: ''
    }),
  }

  static getTemplatesDir(): string {
    // return local templates folder if present
    const TEMPLATES = 'templates'
    const templatesDir = path.resolve(TEMPLATES)
    const exists = fs.pathExistsSync(templatesDir)
    if (exists) {
      return TEMPLATES
    }
    // else use the location from modules
    return path.join(__dirname, '../../../../chectl/templates')
  }

  static setPlaformDefaults(flags: any) {
    if (flags.platform === 'minishift') {
      if (!flags.multiuser && flags.installer === '') {
        flags.installer = 'minishift-addon'
      }
      if (flags.multiuser && flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'minikube') {
      if (!flags.multiuser && flags.installer === '') {
        flags.installer = 'helm'
      }
      if (flags.multiuser && flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'openshift') {
      if (flags.installer === '') {
        flags.installer = 'operator'
      }
    } else if (flags.platform === 'k8s') {
      if (flags.installer === '') {
        flags.installer = 'helm'
      }
    } else if (flags.platform === 'docker-desktop') {
      if (flags.installer === '') {
        flags.installer = 'helm'
      }
    }
  }

  async run() {
    const { flags } = this.parse(Start)
    kube = new KubeHelper(flags)
    Start.setPlaformDefaults(flags)
    const minikube = new MinikubeHelper()
    const microk8s = new MicroK8sHelper()
    const minishift = new MinishiftHelper()
    const openshift = new OpenShiftPlatform()
    const oc = new OpenShiftHelper()
    const k8s = new K8sHelper()
    const dockerDesktop = new DockerDesktopHelper()
    const helm = new HelmHelper()
    const che = new CheHelper()
    const operator = new OperatorHelper()
    const minishiftAddon = new MinishiftAddonHelper()

    // matrix checks
    if (flags.installer) {
      if (flags.installer === 'minishift-addon') {
        if (flags.platform !== 'minishift') {
          this.error(`🛑 Current platform is ${flags.platform}. Minishift addon is only available on top of Minishift platform.`)
        }
      } else if (flags.installer === 'helm') {
        if (flags.platform !== 'k8s' && flags.platform !== 'minikube' && flags.platform !== 'microk8s' && flags.platform !== 'docker-desktop') {
          this.error(`🛑 Current platform is ${flags.platform}. Helm installer is only available on top of Kubernetes flavor platform (including Minikube, Docker Desktop).`)
        }
      }
      if (flags['os-oauth']) {
        if (flags.platform !== 'openshift' && flags.platform !== 'minishift') {
          this.error(`You requested to enable OpenShift OAuth but the platform doesn\'t seem to be OpenShift. Platform is ${flags.platform}.`)
        }
        if (flags.installer !== 'operator') {
          this.error(`You requested to enable OpenShift OAuth but that's only possible when using the operator as installer. The current installer is ${flags.installer}. To use the operator add parameter "--installer operator".`)
        }
      }
    }

    // Platform Checks
    let platformCheckTasks = new Listr(undefined, { renderer: flags['listr-renderer'] as any, collapse: false })
    if (flags.platform === 'minikube') {
      platformCheckTasks.add({
        title: '✈️  Minikube preflight checklist',
        task: () => minikube.startTasks(flags, this)
      })
    } else if (flags.platform === 'minishift') {
      platformCheckTasks.add({
        title: '✈️  Minishift preflight checklist',
        task: () => minishift.startTasks(flags, this)
      })
    } else if (flags.platform === 'microk8s') {
      platformCheckTasks.add({
        title: '✈️  MicroK8s preflight checklist',
        task: () => microk8s.startTasks(flags, this)
      })
    } else if (flags.platform === 'openshift') {
      platformCheckTasks.add({
        title: '✈️  Openshift preflight checklist',
        task: () => openshift.startTasks(flags, this)
      })
    } else if (flags.platform === 'k8s') {
      platformCheckTasks.add({
        title: '✈️  Kubernetes preflight checklist',
        task: () => k8s.startTasks(flags, this)
      })
    } else if (flags.platform === 'docker-desktop') {
      platformCheckTasks.add({
        title: '✈️  Docker Desktop preflight checklist',
        task: () => dockerDesktop.startTasks(flags, this)
      })
    } else {
      this.error(`Platformm ${flags.platform} is not supported yet ¯\\_(ツ)_/¯`)
      this.exit()
    }

    let cheExistenceTasks = new Listr(undefined, { renderer: flags['listr-renderer'] as any, collapse: false })
    let globalCtx: any = {};

    cheExistenceTasks.add({
      title: 'Check if Che is already deployed',
      task: () => new Listr([
        {
          title: 'Verify Kubernetes API',
          task: async (_ctx: any, task: any) => {
            try {
              await kube.checkKubeApi()
              globalCtx.isOpenShift = await kube.isOpenShift()
              task.title = await `${task.title}...done`
              if (globalCtx.isOpenShift) {
                task.title = await `${task.title} (it's OpenShift)`
              }
            } catch (error) {
              this.error(`Failed to connect to Kubernetes API. ${error.message}`)
            }
          }
        },
        {
          title: `Verify if deployment \"${flags['deployment-name']}\" exist in namespace \"${flags.chenamespace}\"`,
          task: async (_ctx: any, task: any) => {
            if (globalCtx.isOpenShift && await oc.deploymentConfigExist(flags['deployment-name'], flags.chenamespace)) {
              // minishift addon and the openshift templates use a deployment config
              globalCtx.cheServerIsDeployed = true
              globalCtx.deploymentConfigExist = true
              globalCtx.foundKeycloakDeployment = await oc.deploymentConfigExist('keycloak', flags.chenamespace)
              globalCtx.foundPostgresDeployment = await oc.deploymentConfigExist('postgres', flags.chenamespace)
              globalCtx.foundDevfileRegistryDeployment = await kube.deploymentExist('devfile-registry', flags.chenamespace)
              globalCtx.foundPluginRegistryDeployment = await kube.deploymentExist('plugin-registry', flags.chenamespace)
              
              let deployedDeployments = this.getDeployedDeployments(globalCtx)
              if (deployedDeployments) {
                task.title = await `${task.title}...the dc "${flags['deployment-name']}" exists (as well as ${deployedDeployments})`
              } else {
                task.title = await `${task.title}...the dc "${flags['deployment-name']}" exists`
              }
            } else if (await kube.deploymentExist(flags['deployment-name'], flags.chenamespace)) {
              // helm chart and Che operator use a deployment
              globalCtx.cheServerIsDeployed = true
              globalCtx.foundKeycloakDeployment = await kube.deploymentExist('keycloak', flags.chenamespace)
              globalCtx.foundPostgresDeployment = await kube.deploymentExist('postgres', flags.chenamespace)
              globalCtx.foundDevfileRegistryDeployment = await kube.deploymentExist('devfile-registry', flags.chenamespace)
              globalCtx.foundPluginRegistryDeployment = await kube.deploymentExist('plugin-registry', flags.chenamespace)

              let deployedDeployments = this.getDeployedDeployments(globalCtx)
              if (deployedDeployments) {
                task.title = await `${task.title}...it does (as well as ${deployedDeployments})`
              } else {
                task.title = await `${task.title}...it does`
              }
            } else {
              globalCtx.cheServerIsDeployed = false
              task.title = await `${task.title}...is not deployed at yet`
            }
          }
        },
        {
          title: 'Checking if Che endpoints are available',
          enabled: () => globalCtx.cheServerIsDeployed,
          task: async (_ctx: any, task: any) => {
            globalCtx.cheURL = await che.cheURL(flags.chenamespace)
            if (await che.isCheServerReady(globalCtx.cheURL)) {
              task.title = await `${task.title}...AVAILABLE`
              globalCtx.cheServerIsReady = true
            } else {
              task.title = await `${task.title}...NOT AVAILABLE`
              globalCtx.cheServerIsReady = false
            }
          }
        }
      ],
        { renderer: flags['listr-renderer'] as any, collapse: false }
      )
    })

    let recoverCheTask = new Listr({ renderer: flags['listr-renderer'] as any, collapse: false })
    recoverCheTask.add({
      title: 'Recover Che Server',
      task: () => new Listr([
       {
          title: 'Scale \"devfile registry\"  deployment to one',
          enabled: (ctx: any) => ctx.foundDevfileRegistryDeployment,
          task: async (_ctx: any, task: any) => {
            try {
              if (globalCtx.deploymentConfigExist) {
                await oc.scaleDeploymentConfig('devfile-registry', flags.chenamespace, 1)
              } else {
                await kube.scaleDeployment('devfile-registry', flags.chenamespace, 1)
              }
              task.title = await `${task.title}...done`
            } catch (error) {
              this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale devfile-registry deployment. ${error.message}`)
            }
          }
        },
        {
          title: 'Wait until Devfile registry pod is scaled',
          enabled: (ctx: any) => ctx.foundDevfileRegistryDeployment,
          task: async (_ctx: any, task: any) => {
            await kube.waitUntilPodIsDeployed('app=che,component=devfile-registry', flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
        {
          title: 'Scale \"plugin registry\"  deployment to one',
          enabled: (_ctx: any) => globalCtx.foundPluginRegistryDeployment,
          task: async (_ctx: any, task: any) => {
            try {
              if (globalCtx.deploymentConfigExist) {
                await oc.scaleDeploymentConfig('plugin-registry', flags.chenamespace, 1)
              } else {
                await kube.scaleDeployment('plugin-registry', flags.chenamespace, 1)
              }
              task.title = await `${task.title}...done`
            } catch (error) {
              this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale plugin-registry deployment. ${error.message}`)
            }
          }
        },
        {
          title: 'Wait until Plugin registry pod is scaled',
          enabled: (_ctx: any) => globalCtx.foundPluginRegistryDeployment,
          task: async (_ctx: any, task: any) => {
            await kube.waitUntilPodIsDeployed('app=che,component=plugin-registry', flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
        {
          title: 'Scale \"postgres\"  deployment to one',
          enabled: (_ctx: any) => globalCtx.foundPostgresDeployment,
          task: async (_ctx: any, task: any) => {
            try {
              if (globalCtx.deploymentConfigExist) {
                await oc.scaleDeploymentConfig('postgres', flags.chenamespace, 1)
              } else {
                await kube.scaleDeployment('postgres', flags.chenamespace, 1)
              }
              task.title = await `${task.title}...done`
            } catch (error) {
              this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale postgres deployment. ${error.message}`)
            }
          }
        },
        {
          title: 'Wait until Postgres pod is scaled',
          enabled: (ctx: any) => globalCtx.foundKeycloakDeployment,
          task: async (_ctx: any, task: any) => {
            await kube.waitUntilPodIsDeployed('app=postgres', flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
        {
          title: 'Scale \"keycloak\"  deployment to one',
          enabled: (ctx: any) => !globalCtx.isAlreadyStopped && !globalCtx.isNotReadyYet && globalCtx.foundKeycloakDeployment,
          task: async (ctx: any, task: any) => {
            try {
              if (globalCtx.deploymentConfigExist) {
                await oc.scaleDeploymentConfig('keycloak', flags.chenamespace, 1)
              } else {
                await kube.scaleDeployment('keycloak', flags.chenamespace, 1)
              }
              task.title = await `${task.title}...done`
            } catch (error) {
              this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale keycloak deployment. ${error.message}`)
            }
          }
        },
        {
          title: 'Wait until Keycloak pod is scaled',
          enabled: (ctx: any) => globalCtx.foundKeycloakDeployment,
          task: async (_ctx: any, task: any) => {
            await kube.waitUntilPodIsDeployed('app=keycloak', flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
        {
          title: `Scale \"${flags['deployment-name']}\"  deployment to one`,
          // enabled: () => !globalCtx.isAlreadyStopped && !globalCtx.isNotReadyYet,
          task: async (task: any) => {
            try {
              if (globalCtx.deploymentConfigExist) {
                await oc.scaleDeploymentConfig(flags['deployment-name'], flags.chenamespace, 1)
              } else {
                await kube.scaleDeployment(flags['deployment-name'], flags.chenamespace, 1)
              }
              task.title = await `${task.title}...done`
            } catch (error) {
              this.error(`E_SCALE_DEPLOY_FAIL - Failed to scale deployment. ${error.message}`)
            }
          }
        },
        {
          title: 'Wait until Che pod is scaled',
          // enabled: (ctx: any) => !ctx.isAlreadyStopped && !ctx.isNotReadyYet,
          task: async (_ctx: any, task: any) => {
            await kube.waitUntilPodIsDeployed('app=che,component=che', flags.chenamespace)
            task.title = `${task.title}...done.`
          }
        },
      ], 
      { renderer: flags['listr-renderer'] as any, collapse: false }
      )
    })

    // Installer
    let installerTasks = new Listr({ renderer: flags['listr-renderer'] as any, collapse: false })
    if (flags.installer === 'helm') {
      installerTasks.add({
        title: '🏃‍  Running Helm to install Che',
        task: () => helm.startTasks(flags, this)
      })
    } else if (flags.installer === 'operator') {
      // The operator installs Che multiuser only
      if (!flags.multiuser) {
        this.warn("Che will be deployed in Multi-User mode since Configured 'operator' installer which support only such.")  
      }
      flags.multiuser = true
      // Installers use distinct ingress names
      installerTasks.add({
        title: '🏃‍  Running the Che Operator',
        task: () => operator.startTasks(flags, this)
      })
    } else if (flags.installer === 'minishift-addon') {
      // minishift-addon supports Che singleuser only
      flags.multiuser = false
      // Installers use distinct ingress names
      installerTasks.add({
        title: '🏃‍  Running the Che minishift-addon',
        task: () => minishiftAddon.startTasks(flags, this)
      })
    } else {
      this.error(`Installer ${flags.installer} is not supported ¯\\_(ツ)_/¯`)
      this.exit()
    }

    // Post Install Checks
    let cheBootstrapSubTasks = new Listr()
    const cheStartCheckTasks = new Listr([{
      title: '✅  Post installation checklist',
      task: () => cheBootstrapSubTasks
    }],
      {
        renderer: flags['listr-renderer'] as any,
        collapse: false
      }
    )

    if (flags.multiuser) {
      cheBootstrapSubTasks.add({
        title: 'PostgreSQL pod bootstrap',
        task: () => this.podStartTasks(this.getPostgresSelector(), flags.chenamespace)
      })
      cheBootstrapSubTasks.add({
        title: 'Keycloak pod bootstrap',
        task: () => this.podStartTasks(this.getKeycloakSelector(), flags.chenamespace)
      })
    }

    if (!flags['devfile-registry-url'] && flags.installer !== 'minishift-addon') {
      cheBootstrapSubTasks.add({
        title: 'Devfile registry pod bootstrap',
        task: () => this.podStartTasks(this.getDevfileRegistrySelector(), flags.chenamespace)
      })
    }

    if (!flags['plugin-registry-url'] && flags.installer !== 'minishift-addon') {
      cheBootstrapSubTasks.add({
        title: 'Plugin registry pod bootstrap',
        task: () => this.podStartTasks(this.getPluginRegistrySelector(), flags.chenamespace)
      })
    }

    cheBootstrapSubTasks.add({
      title: 'Che pod bootstrap',
      task: () => this.podStartTasks(flags['che-selector'] as string, flags.chenamespace)
    })

    cheBootstrapSubTasks.add({
      title: 'Retrieving Che Server URL',
      task: async (ctx: any, task: any) => {
        ctx.cheURL = await che.cheURL(flags.chenamespace)
        task.title = await `${task.title}...${ctx.cheURL}`
      }
    })

    cheBootstrapSubTasks.add({
      title: 'Che status check',
      task: async ctx => che.waitCheServerReady(ctx.cheURL)
    })

    try {
      await platformCheckTasks.run()
      await cheExistenceTasks.run()
      if (globalCtx.cheServerIsDeployed) {
        if (globalCtx.cheServerIsReady) {
          this.log(`Che Server is already running and available at ${globalCtx.cheURL}`)
        } else {
          await recoverCheTask.run()
          await cheStartCheckTasks.run()
        }
      } else {
        await installerTasks.run()
        await cheStartCheckTasks.run()
      }

      this.log('Command server:start has completed successfully.')
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:start has completed successfully.'
    })

    this.exit(0)
  }

  getDeployedDeployments(globalCtx: any):string {
    let existingDeployments = ''
    if (globalCtx.foundKeycloakDeployment) {
      existingDeployments += ", keycloak"
    } 
    if (globalCtx.foundPostgresDeployment) {
      existingDeployments += ", postgres"
    }
    if (globalCtx.foundDevfileRegistryDeployment) {
      existingDeployments += ", devfile-registry"
    }
    if (globalCtx.foundPluginRegistryDeployment) {
      existingDeployments += ", plugin-registry"
    }
    
    return existingDeployments
  } 

  getPostgresSelector(): string {
    return 'app=che,component=postgres'
  }

  getKeycloakSelector(): string {
    return 'app=che,component=keycloak'
  }

  getDevfileRegistrySelector(): string {
    return 'app=che,component=devfile-registry'
  }

  getPluginRegistrySelector(): string {
    return 'app=che,component=plugin-registry'
  }

  podStartTasks(selector: string, namespace = ''): Listr {
    return new Listr([
      {
        title: 'scheduling',
        task: async (_ctx: any, task: any) => {
          let phase
          const title = task.title
          try {
            phase = await kube.getPodPhase(selector, namespace)
          } catch (_err) {
            // not able to grab current phase
            this.debug(_err)
          }
          // wait only if not yet running
          if (phase !== 'Running') {
            await kube.waitForPodPending(selector, namespace)
          }
          task.title = `${title}...done.`
        }
      },
      {
        title: 'downloading images',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodPhase(selector, 'Running', namespace)
          task.title = `${task.title}...done.`
        }
      },
      {
        title: 'starting',
        task: async (_ctx: any, task: any) => {
          await kube.waitForPodReady(selector, namespace)
          task.title = `${task.title}...done.`
        }
      }
    ])
  }
}
