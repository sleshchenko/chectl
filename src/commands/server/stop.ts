/*********************************************************************
 * Copyright (c) 2019 Red Hat, Inc.
 *
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 **********************************************************************/

import { Command, flags } from '@oclif/command'
import { string } from '@oclif/parser/lib/flags'

import { KubeHelper } from '../../api/kube'
import { CheTasks } from '../../tasks/che'
import { accessToken, cheDeployment, cheNamespace, listrRenderer } from '../flags'

export default class Stop extends Command {
  static description = 'stop Eclipse Che Server'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'deployment-name': cheDeployment,
    'che-selector': string({
      description: 'Selector for Che Server resources',
      default: 'app=che,component=che',
      env: 'CHE_SELECTOR'
    }),
    'access-token': accessToken,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Stop)
    const Listr = require('listr')
    const notifier = require('node-notifier')
    const cheTasks = new CheTasks(flags)
    const kh = new KubeHelper(flags)
    let tasks = new Listr([
      {
        title: 'Verify Kubernetes API',
        task: async (ctx: any, task: any) => {
          try {
            await kh.checkKubeApi()
            ctx.isOpenShift = await kh.isOpenShift()
            task.title = await `${task.title}...done`
            if (ctx.isOpenShift) {
              task.title = await `${task.title} (it's OpenShift)`
            }
          } catch (error) {
            this.error(`Failed to connect to Kubernetes API. ${error.message}`)
          }
        }
      }
    ],
      { renderer: flags['listr-renderer'] as any }
    )

    tasks.add(cheTasks.checkIfCheIsInstalledTasks(this))
    tasks.add([{
      title: 'Deployment Config doesn\'t exist',
      enabled: (ctx: any) => !ctx.isCheDeployed,
      task: async () => {
        await this.error(`E_BAD_DEPLOY - Deployment and DeploymentConfig do not exist.\nNeither a Deployment nor a DeploymentConfig named "${flags['deployment-name']}" exist in namespace \"${flags.chenamespace}\", Che Server cannot be stopped.\nFix with: verify the namespace where Che is running (oc get projects)\nhttps://github.com/eclipse/che`, { code: 'E_BAD_DEPLOY' })
      }
    },
    {
      title: 'Che server was already stopped',
      enabled: (ctx: any) => (ctx.isStopped),
      task: async () => { }
    },
    {
      title: 'Che server Pod is not ready. It may be failing to start. Skipping shutdown request',
      enabled: (ctx: any) => (ctx.isNotReadyYet),
      task: async () => { }
    },
      cheTasks.scaleCheDownTasks(this),
    ],
      { renderer: flags['listr-renderer'] as any }
    )

    try {
      await tasks.run()
    } catch (err) {
      this.error(err)
    }

    notifier.notify({
      title: 'chectl',
      message: 'Command server:stop has completed.'
    })

    this.exit(0)
  }
}
