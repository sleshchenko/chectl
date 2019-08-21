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
import { HelmHelper } from '../../installers/helm'
import { MinishiftAddonHelper } from '../../installers/minishift-addon'
import { OperatorHelper } from '../../installers/operator'
import { DockerDesktopHelper } from '../../platforms/docker-desktop'
import { K8sHelper } from '../../platforms/k8s'
import { MicroK8sHelper } from '../../platforms/microk8s'
import { MinikubeHelper } from '../../platforms/minikube'
import { MinishiftHelper } from '../../platforms/minishift'
import { OpenshiftHelper } from '../../platforms/openshift'
import { CheTasks } from '../../tasks/che';
import { FLAGS } from '../flags';

export default class Start extends Command {
  static description = 'start Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: FLAGS.CHE_NAMESPACE,
    'deployment-name': string({
      description: 'Che deployment name',
      default: 'che',
      env: 'CHE_DEPLOYMENT'
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
    multiuser: FLAGS,
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
    Start.setPlaformDefaults(flags)
    const minikube = new MinikubeHelper()
    const microk8s = new MicroK8sHelper()
    const minishift = new MinishiftHelper()
    const openshift = new OpenshiftHelper()
    const k8s = new K8sHelper()
    const dockerDesktop = new DockerDesktopHelper()
    const helm = new HelmHelper()
    const che = new CheHelper()
    const operator = new OperatorHelper()
    const minishiftAddon = new MinishiftAddonHelper()
    const cheTasks = new CheTasks(flags)

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

    // Installer
    let installerTasks = new Listr({ renderer: flags['listr-renderer'] as any, collapse: false })
    if (flags.installer === 'helm') {
      installerTasks.add({
        title: '🏃‍  Running Helm to install Che',
        task: () => helm.startTasks(flags, this)
      })
    } else if (flags.installer === 'operator') {
      // The operator installs Che multiuser only
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

    // Checks if Che is already deployed
    const preInstallTasks = new Listr([{
      title: '👀  Looking for an already existing Che instance',
      task: () => new Listr(cheTasks.checkIsCheIsInstalledTasks(this))
    }], {
        renderer: flags['listr-renderer'] as any,
        collapse: false
      })

    const startDeployedCheTasks = new Listr([{
      title: '👀  Starting already deployed Che',
      task: () => new Listr(cheTasks.scaleCheUpTasks(this))
    }], {
        renderer: flags['listr-renderer'] as any,
        collapse: false
      })

    // Post Install Checks
    let postInstallSubTasks = new Listr()
    const postInstallTasks = new Listr([{
      title: '✅  Post installation checklist',
      task: () => postInstallSubTasks
    }], {
        renderer: flags['listr-renderer'] as any,
        collapse: false
      })

    postInstallSubTasks.add({
      enabled: (ctx) => (flags.multiuser || ctx.postgresDeploymentExist),
      title: 'PostgreSQL pod bootstrap',
      task: () => cheTasks.waitDevfileRegistryPodTasks(this)
    })

    postInstallSubTasks.add({
      enabled: (ctx) => (flags.multiuser || ctx.keycloakDeploymentExist),
      title: 'Keycloak pod bootstrap',
      task: () => cheTasks.waitKeycloakPodTasks(this)
    })

    if (!flags['devfile-registry-url'] && flags.installer !== 'minishift-addon') {
      postInstallSubTasks.add({
        title: 'Devfile registry pod bootstrap',
        task: () => cheTasks.waitDevfileRegistryPodTasks(this)
      })
    }

    if (!flags['plugin-registry-url'] && flags.installer !== 'minishift-addon') {
      postInstallSubTasks.add({
        title: 'Plugin registry pod bootstrap',
        task: () => cheTasks.waitPluginRegistryPodTasks(this)
      })
    }

    postInstallSubTasks.add({
      title: 'Che pod bootstrap',
      task: () => cheTasks.waitChePodTasks(this)
    })

    postInstallSubTasks.add({
      title: 'Retrieving Che Server URL',
      task: async (ctx: any, task: any) => {
        ctx.cheURL = await che.cheURL(flags.chenamespace)
        task.title = await `${task.title}...${ctx.cheURL}`
      }
    })

    postInstallSubTasks.add({
      title: 'Che status check',
      task: async ctx => che.isCheServerReady(ctx.cheURL)
    })

    try {
      const ctx: any = {};
      await platformCheckTasks.run(ctx)
      await preInstallTasks.run(ctx)
      if (ctx.isCheDeployed) {
        await startDeployedCheTasks.run(ctx)
      }
      if (!ctx.cheIsAlreadyRunning && !ctx.cheDeploymentExist) {
        await installerTasks.run(ctx)
      }
      if (!ctx.cheIsAlreadyRunning) {
        await postInstallTasks.run(ctx)
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
}
