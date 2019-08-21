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
import * as Listrq from 'listr'

import { CheTasks } from '../../tasks/che'
import { HelmTasks } from '../../tasks/installers/helm'
import { MinishiftAddonTasks } from '../../tasks/installers/minishift-addon'
import { OperatorTasks } from '../../tasks/installers/operator'
import { K8sTasks } from '../../tasks/platforms/k8s'
import { cheNamespace, listrRenderer } from '../flags'

export default class Delete extends Command {
  static description = 'delete any Che related resource: Kubernetes/OpenShift/Helm'

  static flags = {
    help: flags.help({ char: 'h' }),
    chenamespace: cheNamespace,
    'listr-renderer': listrRenderer
  }

  async run() {
    const { flags } = this.parse(Delete)

    const notifier = require('node-notifier')

    const k8sTasks = new K8sTasks()
    const helmTasks = new HelmTasks()
    const msAddonTasks = new MinishiftAddonTasks()
    const operatorTasks = new OperatorTasks()
    const cheTasks = new CheTasks()

    let tasks = new Listrq([
      k8sTasks.testApiTasks(flags, this),
      operatorTasks.deleteTasks(flags),
      cheTasks.deleteTasks(flags),
      helmTasks.deleteTasks(flags),
      msAddonTasks.deleteTasks(flags),
    ],
      { renderer: flags['listr-renderer'] as any }
    )

    await tasks.run()

    notifier.notify({
      title: 'chectl',
      message: 'Command server:update has completed.'
    })

    this.exit(0)
  }
}
