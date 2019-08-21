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
import * as Listr from 'listr'
import { Command } from '@oclif/command'

export class KubeTasks {
    kube: KubeHelper

    constructor(flags?: any) {
        this.kube = new KubeHelper(flags);
    }

    podStartTasks(command: Command, selector: string, namespace = ''): Listr {
        return new Listr([
          {
            title: 'scheduling',
            task: async (_ctx: any, task: any) => {
              let phase
              const title = task.title
              try {
                phase = await this.kube.getPodPhase(selector, namespace)
              } catch (_err) {
                // not able to grab current phase
                // command.debug(_err)
              }
              // wait only if not yet running
              if (phase !== 'Running') {
                await this.kube.waitForPodPending(selector, namespace)
              }
              task.title = `${title}...done.`
            }
          },
          {
            title: 'downloading images',
            task: async (_ctx: any, task: any) => {
              await this.kube.waitForPodPhase(selector, 'Running', namespace)
              task.title = `${task.title}...done.`
            }
          },
          {
            title: 'starting',
            task: async (_ctx: any, task: any) => {
              await this.kube.waitForPodReady(selector, namespace)
              task.title = `${task.title}...done.`
            }
          }
        ])
      }
}