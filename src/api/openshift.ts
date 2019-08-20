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

import execa = require('execa')

export class OpenShiftHelper {
  oc = require('openshift-rest-client').OpenshiftClient;

  async status(): Promise<boolean> {
    const command = 'oc'
    const args = ['status']
    const { code } = await execa(command, args, { timeout: 60000, reject: false })
    if (code === 0) { return true } else { return false }
  }

  async getRouteURL(name: string, namespace = ''): Promise<string> {
    try {
      const client = await this.oc()
      const response = await client.apis['route'].v1.namespaces(namespace).routes(name).get()
      const route = response.body
      const tls = route.spec.tls
      if (tls && tls.termination && (tls.termination.includes('edge') || tls.termination.includes('passthrough') || tls.termination.includes('reencrypt'))) {
        return `https://${route.spec.host}`
      } else {
        return `http://${route.spec.host}`
      }
    } catch (e) {
      if (e.statusCode == 404) {
        throw new Error(`ERR_ROUTE_NO_EXIST - No route ${name} in namespace ${namespace}`)
      }
      if (e.body && e.body.message) throw new Error(e.body.message)
      else throw new Error(e)
    }
  }

  async routeExist(name: string, namespace = ''): Promise<boolean> {
    try {
      const client = await this.oc()
      await client.apis['route'].v1.namespaces(namespace).routes(name).get()
      return true
    } catch (e) {
      if (e.statusCode == 404) {
        return false
      }
      if (e.body && e.body.message) throw new Error(e.body.message)
      else throw new Error(e)
    }
  }

  async deleteAllRoutes(namespace = '') {
    const command = 'oc'
    const args = ['delete', 'route', '--all', '--namespace', namespace]
    await execa(command, args, { timeout: 60000 })
  }

  async deploymentConfigExist(name = '', namespace = ''): Promise<boolean> {
    const command = 'oc'
    const args = ['get', 'deploymentconfig', '--namespace', namespace, '-o', `jsonpath={range.items[?(.metadata.name=='${name}')]}{.metadata.name}{end}`]
    const { stdout } = await execa(command, args, { timeout: 60000 })
    return stdout.trim().includes(name)
  }
  async scaleDeploymentConfig(name = '', namespace = '', replicas: number) {
    const command = 'oc'
    const args = ['scale', 'deploymentconfig', '--namespace', namespace, name, `--replicas=${replicas}`]
    await execa(command, args, { timeout: 60000 })
  }
  async deleteAllDeploymentConfigs(namespace = '') {
    const command = 'oc'
    const args = ['delete', 'deploymentconfig', '--all', '--namespace', namespace]
    await execa(command, args, { timeout: 60000 })
  }
}
