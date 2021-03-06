const { addDefault } = require('@babel/helper-module-imports')
const resolveModule = require('./modules')

const SPECIAL_TYPES = ['isMemberExpression', 'isProperty']

function isSpecialTypes(types, node) {
  return SPECIAL_TYPES.filter(type => types[type](node)).length > 0
}

module.exports = function({ types }) {
  let authKit, removablePaths, specified, selectedMethods

  function importMethod(stateOpts, methodName, file) {
    if (!selectedMethods[methodName]) {
      let path = resolveModule(stateOpts, methodName)

      selectedMethods[methodName] = addDefault(file.path, path, {
        nameHint: methodName
      })
    }

    return types.clone(selectedMethods[methodName])
  }

  function matchesKits(path, name) {
    return (
      authKit[name] &&
      (hasBindingOfType(path.scope, name, 'ImportDefaultSpecifier') ||
        hasBindingOfType(path.scope, name, 'ImportNamespaceSpecifier'))
    )
  }

  function matchesKitsMethod(path, name) {
    return (
      specified[name] && hasBindingOfType(path.scope, name, 'ImportSpecifier')
    )
  }

  function hasBindingOfType(scope, name, type) {
    return scope.hasBinding(name) && scope.getBinding(name).path.type === type
  }

  return {
    visitor: {
      Program: {
        enter() {
          authKit = Object.create(null)
          removablePaths = []
          specified = Object.create(null)
          selectedMethods = Object.create(null)
        },
        exit() {
          removablePaths
            .filter(path => !path.removed)
            .forEach(path => path.remove())
        }
      },
      ImportDeclaration(path, state = { opts: {} }) {
        const {
          node: { source, specifiers }
        } = path

        if (source.value === state.opts.lib) {
          specifiers.forEach(spec => {
            if (types.isImportSpecifier(spec)) {
              specified[spec.local.name] = spec.imported.name

              return
            }

            authKit[spec.local.name] = true
          })

          path.replaceWith(types.nullLiteral())

          removablePaths.push(path)
        }
      },
      ExportNamedDeclaration(path, state = { opts: {} }) {
        const { node, hub } = path

        if (node.source && node.source.value === state.opts.lib) {
          const specifiers = node.specifiers.map(spec => {
            const importIdentifier = importMethod(
              state.opts,
              spec.exported.name,
              hub.file
            )

            const exportIdentifier = types.identifier(spec.local.name)

            return types.exportSpecifier(importIdentifier, exportIdentifier)
          })

          node.specifiers = specifiers
          node.source = null
        }
      },
      ExportAllDeclaration(path, state = { opts: {} }) {
        const {
          node: { source }
        } = path

        if (source && source.value === state.opts.lib) {
          throw new Error(
            '`export * from "authkit"` defeats the purpose of babel-plugin-authkit'
          )
        }
      },
      CallExpression(path, state) {
        const { node, hub } = path
        const { name } = node.callee

        if (!types.isIdentifier(node.callee)) return

        if (matchesKitsMethod(path, name)) {
          node.callee = importMethod(state.opts, specified[name], hub.file)
        }

        if (node.arguments) {
          node.arguments = node.arguments.map(arg => {
            const { name } = arg

            return matchesKitsMethod(path, name)
              ? importMethod(state.opts, specified[name], hub.file)
              : arg
          })
        }
      },
      MemberExpression(path, state) {
        const { node } = path
        const objectName = node.object.name

        if (!matchesKits(path, objectName)) return

        const newNode = importMethod(
          state.opts,
          node.property.name,
          path.hub.file
        )

        path.replaceWith({ type: newNode.type, name: newNode.name })
      },
      Property(path, state) {
        const { node, hub } = path

        if (
          types.isIdentifier(node.key) &&
          node.computed &&
          matchesKitsMethod(path, node.key.name)
        ) {
          node.key = importMethod(
            state.opts,
            specified[node.key.name],
            hub.file
          )
        }

        if (
          types.isIdentifier(node.value) &&
          matchesKitsMethod(path, node.value.name)
        ) {
          node.value = importMethod(
            state.opts,
            specified[node.value.name],
            hub.file
          )
        }
      },
      Identifier(path, state) {
        const { node, hub, parent } = path
        const { name } = node

        if (matchesKitsMethod(path, name) && !isSpecialTypes(types, parent)) {
          const newNode = importMethod(state.opts, specified[name], hub.file)

          path.replaceWith({ type: newNode.type, name: newNode.name })
        } else if (matchesKits(path, name)) {
          const replacementNode = types.nullLiteral()

          path.replaceWith(replacementNode)
        }
      }
    }
  }
}
