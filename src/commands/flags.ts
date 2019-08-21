import { string } from '@oclif/parser/lib/flags'

export namespace FLAGS {
  export const CHE_NAMESPACE = string({
    char: 'n',
    description: 'Kubernetes namespace where Che resources will be deployed',
    default: 'che',
    env: 'CHE_NAMESPACE'
  })
}