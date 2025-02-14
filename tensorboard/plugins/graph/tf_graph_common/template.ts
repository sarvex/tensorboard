/* Copyright 2015 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the 'License');
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an 'AS IS' BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
import {graphlib} from 'dagre';
import * as _ from 'lodash';

import {
  GroupNode,
  hasSimilarDegreeSequence,
  Metanode,
  NodeType,
  OpNode,
  SeriesNode,
} from './graph';
import {Hierarchy} from './hierarchy';

export function detect(
  h,
  verifyTemplate
): {
  [templateId: string]: string[];
} {
  // In any particular subgraph, there are either
  // - leaf nodes (which do not have subgraph)
  // - metanode nodes - some of them have only one member (singular metanode)
  //                    and some have multiple members (non-singular metanode)
  // First, generate a nearest neighbor hash of metanode nodes.
  let nnGroups = clusterSimilarSubgraphs(h);
  // For each metanode, compare its subgraph (starting from shallower groups)
  // and assign template id.
  let templates = groupTemplateAndAssignId(nnGroups, verifyTemplate);
  // Sort the templates by minimum level in the graph at which they appear,
  // as this leads to optimal setting of the colors of each template for
  // maximum differentiation.
  return <
    {
      [templateId: string]: string[];
    }
  >Object.keys(templates)
    .sort((key) => templates[key].level)
    .reduce((obj, key) => {
      obj[key] = templates[key];
      return obj;
    }, {});
}
/**
 * @return Unique string for a metanode based on depth, |V|, |E| and
 * op type histogram.
 */
function getSignature(metanode) {
  // depth=<number> |V|=<number> |E|=<number>
  let props = _.map(
    {
      depth: metanode.depth,
      '|V|': metanode.metagraph.nodes().length,
      '|E|': metanode.metagraph.edges().length,
    },
    function (v, k) {
      return k + '=' + v;
    }
  ).join(' ');
  // optype1=count1,optype2=count2
  let ops = _.map(metanode.opHistogram, function (count, op) {
    return op + '=' + count;
  }).join(',');
  return props + ' [ops] ' + ops;
}
/**
 * Generate a nearest neighbor hash of metanodes
 * based on depth, |V|, |E|, and opHistogram of their subgraph
 * (excluding leaf nodes and singular metanodes).
 * @param graph The graph
 * @return Array of pairs of [signature,
 *   Object with min level of the template and an Array of tf.graph.Group]
 *   sort by ascending order of minimum depth at which metanode appears.
 */
function clusterSimilarSubgraphs(h: Hierarchy) {
  /** a dict from metanode.signature() => Array of tf.graph.Groups */
  const map = h.getNodeMap();
  let hashDict = Object.keys(map).reduce((reduced: Object, name: string) => {
    const node: OpNode | GroupNode = map[name];
    if (node.type !== NodeType.META) {
      return reduced;
    }
    let levelOfMetaNode = name.split('/').length - 1;
    let signature = getSignature(node);
    let templateInfo = reduced[signature] || {
      nodes: [],
      level: levelOfMetaNode,
    };
    reduced[signature] = templateInfo;
    templateInfo.nodes.push(node);
    if (templateInfo.level > levelOfMetaNode) {
      templateInfo.level = levelOfMetaNode;
    }
    return reduced;
  }, {});
  return Object.keys(hashDict)
    .map((key) => [key, hashDict[key]])
    .filter(([_, subGraph]) => {
      const {nodes} = subGraph;
      if (nodes.length > 1) {
        // There is more than 1 node with this template. It is worth assigning
        // a unique color to this template.
        return true;
      }
      // If there is only 1 node with this template, only make a template for
      // it if it represents a function. In that case, the graph explorer may
      // add more nodes with the template later.
      const node = nodes[0];
      return (
        node.type === NodeType.META && (node as Metanode).associatedFunction
      );
    })
    .sort(([_, subGraph]) => {
      // sort by depth
      // (all members in the same nnGroup has equal depth)
      return subGraph.nodes[0].depth;
    });
}
function groupTemplateAndAssignId(nnGroups, verifyTemplate) {
  // For each metanode, compare its subgraph (starting from shallower groups)
  // and assign template id.
  let result: {
    [templateId: string]: {
      level: number;
      nodes: string[];
    };
  } = {};
  return _.reduce(
    nnGroups,
    function (templates, nnGroupPair) {
      let signature = nnGroupPair[0],
        nnGroup = nnGroupPair[1].nodes,
        clusters = [];
      nnGroup.forEach(function (metanode) {
        // check with each existing cluster
        for (let i = 0; i < clusters.length; i++) {
          let similar =
            !verifyTemplate ||
            isSimilarSubgraph(
              clusters[i].metanode.metagraph,
              metanode.metagraph
            );
          // if similar, just add this metanode to the cluster
          if (similar) {
            // get template from the first one
            metanode.templateId = clusters[i].metanode.templateId;
            clusters[i].members.push(metanode.name);
            return;
          }
        }
        // otherwise create a new cluster with id 'signature [count] '
        metanode.templateId = signature + '[' + clusters.length + ']';
        clusters.push({
          metanode: metanode,
          members: [metanode.name],
        });
      });
      clusters.forEach(function (c) {
        templates[c.metanode.templateId] = {
          level: nnGroupPair[1].level,
          nodes: c.members,
        };
      });
      return templates;
    },
    result
  );
}
function sortNodes(names: string[], graph: graphlib.Graph, prefix: string) {
  return _.sortBy(names, [
    (name) => (graph.node(name) as unknown as OpNode).op,
    (name) => (graph.node(name) as unknown as Metanode).templateId,
    (name) => graph.neighbors(name).length,
    (name) => graph.predecessors(name).length,
    (name) => graph.successors(name).length,
    (name) => name.substr(prefix.length),
  ]);
}
function isSimilarSubgraph(g1: graphlib.Graph, g2: graphlib.Graph) {
  if (!hasSimilarDegreeSequence(g1, g2)) {
    return false;
  }
  // if we want to skip, just return true here.
  // return true;
  // Verify sequence by running DFS
  let g1prefix = (g1.graph() as any).name;
  let g2prefix = (g2.graph() as any).name;
  let visited1 = {};
  let visited2 = {};
  let stack = [];
  /**
   * push sources or successors into the stack
   * if the visiting pattern has been similar.
   */
  function stackPushIfNotDifferent(n1, n2) {
    let sub1 = n1.substr(g1prefix.length),
      sub2 = n2.substr(g2prefix.length);
    /* tslint:disable */
    if (visited1[sub1] ^ visited2[sub2]) {
      console.warn(
        'different visit pattern',
        '[' + g1prefix + ']',
        sub1,
        '[' + g2prefix + ']',
        sub2
      );
      return true;
    }
    /* tslint:enable */
    if (!visited1[sub1]) {
      // implied && !visited2[sub2]
      visited1[sub1] = visited2[sub2] = true;
      stack.push({n1: n1, n2: n2});
    }
    return false;
  }
  // check if have same # of sources then sort and push
  let sources1 = g1.sources();
  let sources2 = g2.sources();
  if (sources1.length !== sources2.length) {
    /* tslint:disable */
    console.log('different source length');
    /* tslint:enable */
    return false;
  }
  sources1 = sortNodes(sources1 as any, g1, g1prefix);
  sources2 = sortNodes(sources2 as any, g2, g2prefix);
  for (let i = 0; i < sources1.length; i++) {
    let different = stackPushIfNotDifferent(sources1[i], sources2[i]);
    if (different) {
      return false;
    }
  }
  while (stack.length > 0) {
    let cur = stack.pop();
    // check node
    let similar = isSimilarNode(g1.node(cur.n1) as any, g2.node(cur.n2) as any);
    if (!similar) {
      return false;
    }
    // check if have same # of successors then sort and push
    let succ1 = g1.successors(cur.n1),
      succ2 = g2.successors(cur.n2);
    if (succ1.length !== succ2.length) {
      /* tslint:disable */
      console.log('# of successors mismatch', succ1, succ2);
      /* tslint:enable */
      return false;
    }
    succ1 = sortNodes(succ1 as any, g1, g1prefix);
    succ2 = sortNodes(succ2 as any, g2, g2prefix);
    for (let j = 0; j < succ1.length; j++) {
      let different = stackPushIfNotDifferent(succ1[j], succ2[j]);
      if (different) {
        return false;
      }
    }
  }
  return true;
}
/**
 * Returns if two nodes have identical structure.
 */
function isSimilarNode(
  n1: OpNode | Metanode | SeriesNode,
  n2: OpNode | Metanode | SeriesNode
): boolean {
  if (n1.type === NodeType.META) {
    // compare metanode
    let metanode1 = <Metanode>n1;
    let metanode2 = <Metanode>n2;
    return (
      metanode1.templateId &&
      metanode2.templateId &&
      metanode1.templateId === metanode2.templateId
    );
  } else if (n1.type === NodeType.OP && n2.type === NodeType.OP) {
    // compare leaf node
    return (<OpNode>n1).op === (<OpNode>n2).op;
  } else if (n1.type === NodeType.SERIES && n2.type === NodeType.SERIES) {
    // compare series node sizes and operations
    // (only need to check one op as all op nodes are identical in series)
    let sn1 = <SeriesNode>n1;
    let sn2 = <SeriesNode>n2;
    let seriesnode1Count = sn1.metagraph.nodeCount();
    return (
      seriesnode1Count === sn2.metagraph.nodeCount() &&
      (seriesnode1Count === 0 ||
        (<any>sn1.metagraph.node(sn1.metagraph.nodes()[0])).op ===
          (<any>sn2.metagraph.node(sn2.metagraph.nodes()[0])).op)
    );
  }
  return false;
}
