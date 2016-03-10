'use babel';
'use strict';

import fs from 'fs';

// Shim atom.packages.serialize in <= 1.6
function packageStatesSerialize() {
  if (typeof atom.packages.serialize === 'function') {
    return atom.packages.serialize();
  }

  for (const pack of atom.packages.getActivePackages()) {
    let state = typeof pack.serialize === 'function' ? pack.serialize() : null;

    if (state) {
      atom.packages.setPackageState(pack.name, state);
    }
  }

  return atom.packages.packageStates;
}

// shim atom.serialize in <= 1.6
function atomSerialize() {
  const options = {
    isUnloading: true
  };

  if (typeof atom.serialize === 'function') {
    return atom.serialize(options);
  }

  return {
    version: atom.constructor.version,
    project: atom.project.serialize(options),
    workspace: atom.workspace.serialize(),
    packageStates: packageStatesSerialize(),
    grammars: {
      grammarOverridesByPath: atom.grammars.grammarOverridesByPath
    },
    fullScreen: atom.isFullScreen(),
    windowDimensions: atom.windowDimensions
  };
}

function saveCurrentState() {
  const currentKey = atom.getStateKey(atom.project.getPaths());
  const currentState = atomSerialize();

  if (currentKey == null) {
    return Promise.resolve(null);
  }

  // Atom 1.7+
  if (atom.stateStore != null) {
    atom.stateStore.save(currentKey, currentState);
  } else {
    const store = atom.getStorageFolder();
    const keypath = store.pathForKey(currentKey);

    return new Promise((resolve, reject) => {
      const stateString = JSON.stringify(currentState);
      fs.writeFile(keypath, stateString, 'utf8', (err) => {
        if (err) {
          return reject(err);
        }

        return resolve();
      });
    });
  }
}

// shim atom.deserialize in <= 1.6
function atomDeserialize(state) {
  if (typeof atom.deserialize === 'function') {
    return atom.deserialize(state);
  }

  const grammarOverridesByPath = state.grammars != null ?
    state.grammars.grammarOverridesByPath : null;

  if (grammarOverridesByPath) {
    atom.grammars.grammarOverridesByPath = grammarOverridesByPath;
  }

  atom.setFullScreen(state.fullScreen);
  atom.packages.packageStates = state.packageStates != null ? state.packageStates : {};

  if (state.project != null) {
    atom.project.deserialize(state.project, atom.deserializers);
  }

  if (state.workspace != null) {
    atom.workspace.deserialize(state.workspace, atom.deserializers);
  }
}

function loadState(key) {
  if (atom.stateStore != null) {
    atom.stateStore.load(key);
  } else {
    return Promise.resolve(atom.getStorageFolder().load(key));
  }
}

export default {
  switchProject: function (project) {
    return new Promise((resolve) => {
      const currentKey = atom.getStateKey(atom.project.getPaths());
      const newKey = atom.getStateKey(project.props.paths);

      saveCurrentState().then(() => {
        const tabs = atom.packages.getActivePackage('tabs');

        if (tabs) {
          for (const tabBarView of tabs.mainModule.tabBarViews) {
            tabBarView.unsubscribe();
          }
        }

        loadState(newKey).then((state) => {
          if (state) {
            atomDeserialize(state);
            const treeViewState = state.packageStates['tree-view'];

            if (treeViewState) {
              const treeViewPackage = atom.packages.getActivePackage('tree-view');
              let treeView = null;
              if (treeViewPackage && treeViewPackage.mainModule != null) {
                treeView = treeViewPackage.mainModule.treeView;
              }

              if (treeView) {
                if (!currentKey && !treeView.isVisible()) {
                  treeView.attach();
                }

                treeView.updateRoots(treeViewState.directoryExpansionStates);
                treeView.selectEntry(treeView.roots[0]);

                if (treeViewState.selectedPath) {
                  treeView.selectEntryForPath(treeViewState.selectedPath);
                }

                if (treeViewState.hasFocus) {
                  treeView.focus();
                }

                if (treeViewState.scrollLeft > 0) {
                  treeView.scroller.scrollLeft(treeViewState.scrollLeft);
                }

                if (treeViewState.scrollTop > 0)  {
                  treeView.scrollTop(treeViewState.scrollTop);
                }

                if (!treeViewState.hasFocus) {
                  atom.workspace.getActivePane().activate();
                }
              }
            }
          } else {
            for (const buffer of atom.project.buffers) {
              if (buffer) {
                buffer.destroy();
              }
            }

            atom.project.setPaths(project.props.paths);
          }

          const pigments = atom.packages.getActivePackage('pigments');
          if (pigments) {
            pigments.mainModule.reloadProjectVariables();
          }

          resolve();
        });
      });
    });
  },

  closeProject: function () {
    saveCurrentState().then(() => {
      for (const buffer of atom.project.getBuffers()) {
        if (buffer) {
          buffer.destroy();
        }

        atom.project.setPaths([]);

        const treeViewPack = atom.packages.getActivePackage('tree-view');
        if (treeViewPack && treeViewPack.mainModule != null) {
          const treeView = treeViewPack.mainModule.treeView;
          if (treeView && treeView.isVisible()) {
            treeView.detach();
          }
        }
      }
    });
  }
};
