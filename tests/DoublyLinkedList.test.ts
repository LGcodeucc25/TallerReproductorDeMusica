import { describe, expect, it } from 'vitest';
import { DoublyLinkedList } from '../src/core/DoublyLinkedList';
import { expectConsistent, seeded } from './helpers';

function listOf(...values: string[]): DoublyLinkedList<string> {
  const list = new DoublyLinkedList<string>();
  values.forEach((value) => list.append(value));
  return list;
}

describe('DoublyLinkedList', () => {
  it('starts empty', () => {
    const list = new DoublyLinkedList<string>();
    expect(list.head).toBeNull();
    expect(list.tail).toBeNull();
    expect(list.length).toBe(0);
    expect(list.printList()).toBe('null');
  });

  it('append and prepend keep head and tail', () => {
    const list = new DoublyLinkedList<string>();
    list.append('B');
    list.append('C');
    list.prepend('A');
    expect(expectConsistent(list)).toEqual(['A', 'B', 'C']);
    expect(list.head?.value).toBe('A');
    expect(list.tail?.value).toBe('C');
  });

  it('traverseToIndex walks from the closest end', () => {
    const list = listOf('A', 'B', 'C', 'D', 'E');
    expect(list.traverseToIndex(0)?.value).toBe('A');
    expect(list.traverseToIndex(3)?.value).toBe('D');
    expect(list.traverseToIndex(4)?.value).toBe('E');
    expect(list.traverseToIndex(5)).toBeNull();
    expect(list.traverseToIndex(-1)).toBeNull();
  });

  it('insert at start, middle and end', () => {
    const list = listOf('B', 'D');
    list.insert(0, 'A');
    list.insert(2, 'C');
    list.insert(99, 'E');
    expect(expectConsistent(list)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('remove head, middle and tail', () => {
    const list = listOf('A', 'B', 'C', 'D');
    expect(list.remove(0)).toBe('A');
    expect(list.remove(1)).toBe('C');
    expect(list.remove(1)).toBe('D');
    expect(list.remove(5)).toBeNull();
    expect(expectConsistent(list)).toEqual(['B']);
    expect(list.remove(0)).toBe('B');
    expect(list.head).toBeNull();
    expect(list.tail).toBeNull();
  });

  it('move relinks the same node', () => {
    const list = listOf('A', 'B', 'C', 'D');
    const nodeA = list.head!;
    expect(list.move(0, 2)).toBe(true);
    expect(expectConsistent(list)).toEqual(['B', 'C', 'A', 'D']);
    expect(list.traverseToIndex(2)).toBe(nodeA);
    list.move(3, 0);
    expect(expectConsistent(list)).toEqual(['D', 'B', 'C', 'A']);
    expect(list.move(0, 9)).toBe(false);
  });

  it('reverse swaps every link', () => {
    const list = listOf('A', 'B', 'C');
    list.reverse();
    expect(expectConsistent(list)).toEqual(['C', 'B', 'A']);
  });

  it('shuffle keeps every node and consistent links', () => {
    const list = listOf('A', 'B', 'C', 'D', 'E', 'F');
    const nodes = new Set(list.nodes());
    list.shuffle(seeded(7));
    const values = expectConsistent(list);
    expect([...values].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const node of list.nodes()) expect(nodes.has(node)).toBe(true);
  });

  it('insertAfter links in the middle and at the tail in O(1)', () => {
    const list = listOf('A', 'C');
    const middle = list.insertAfter(list.head!, 'B');
    expect(expectConsistent(list)).toEqual(['A', 'B', 'C']);
    expect(list.traverseToIndex(1)).toBe(middle);

    const last = list.insertAfter(list.tail!, 'D');
    expect(expectConsistent(list)).toEqual(['A', 'B', 'C', 'D']);
    expect(list.tail).toBe(last);
  });

  it('moveAfter relinks the same node next to another one', () => {
    const list = listOf('A', 'B', 'C', 'D');
    const nodeD = list.tail!;
    list.moveAfter(nodeD, list.head!);
    expect(expectConsistent(list)).toEqual(['A', 'D', 'B', 'C']);
    expect(list.traverseToIndex(1)).toBe(nodeD);
    list.moveAfter(list.head!, list.tail!);
    expect(expectConsistent(list)).toEqual(['D', 'B', 'C', 'A']);
  });

  it('moveToFront relinks the same node as head', () => {
    const list = listOf('A', 'B', 'C');
    const nodeC = list.tail!;
    list.moveToFront(nodeC);
    expect(expectConsistent(list)).toEqual(['C', 'A', 'B']);
    expect(list.head).toBe(nodeC);
    expect(list.tail?.value).toBe('B');
    list.moveToFront(nodeC); // already head: no change
    expect(expectConsistent(list)).toEqual(['C', 'A', 'B']);
    expect(list.length).toBe(3);
  });

  it('moveBefore moves to the head, the middle and next to itself without changes', () => {
    const list = listOf('A', 'B', 'C', 'D');
    const [a, b, c, d] = [...list.nodes()];
    list.moveBefore(d, a);
    expect(expectConsistent(list)).toEqual(['D', 'A', 'B', 'C']);
    expect(list.head).toBe(d);
    expect(list.tail).toBe(c);
    list.moveBefore(a, c);
    expect(expectConsistent(list)).toEqual(['D', 'B', 'A', 'C']);
    list.moveBefore(b, b);
    list.moveBefore(b, a); // already right before A
    expect(expectConsistent(list)).toEqual(['D', 'B', 'A', 'C']);
    expect(new Set(list.nodes())).toEqual(new Set([a, b, c, d]));
  });

  it('moveAfter moves to the tail and next to itself without changes', () => {
    const list = listOf('A', 'B', 'C');
    const [a, b, c] = [...list.nodes()];
    list.moveAfter(a, c);
    expect(expectConsistent(list)).toEqual(['B', 'C', 'A']);
    expect(list.head).toBe(b);
    expect(list.tail).toBe(a);
    list.moveAfter(c, c);
    list.moveAfter(c, b); // already right after B
    expect(expectConsistent(list)).toEqual(['B', 'C', 'A']);
    expect(list.length).toBe(3);
  });

  describe('sort', () => {
    const byText = (a: string, b: string) => a.localeCompare(b);

    it('leaves an empty list and a single node untouched', () => {
      const empty = new DoublyLinkedList<string>();
      empty.sort(byText);
      expect(empty.head).toBeNull();
      expect(empty.tail).toBeNull();
      expect(empty.length).toBe(0);

      const one = listOf('A');
      const node = one.head;
      one.sort(byText);
      expect(expectConsistent(one)).toEqual(['A']);
      expect(one.head).toBe(node);
    });

    it('sorts an already sorted list and a reversed one', () => {
      const sorted = listOf('A', 'B', 'C', 'D', 'E');
      sorted.sort(byText);
      expect(expectConsistent(sorted)).toEqual(['A', 'B', 'C', 'D', 'E']);

      const reversed = listOf('E', 'D', 'C', 'B', 'A');
      reversed.sort(byText);
      expect(expectConsistent(reversed)).toEqual(['A', 'B', 'C', 'D', 'E']);
      expect(reversed.head?.value).toBe('A');
      expect(reversed.tail?.value).toBe('E');
    });

    it('is stable: equal keys keep their previous order', () => {
      const list = listOf('b1', 'a1', 'b2', 'c1', 'a2', 'b3', 'a3');
      list.sort((x, y) => x[0].localeCompare(y[0]));
      expect(expectConsistent(list)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1']);
    });

    it('relinks the same node objects instead of creating new ones', () => {
      const list = listOf('D', 'B', 'E', 'A', 'C', 'F');
      const before = new Map([...list.nodes()].map((node) => [node.value, node]));
      list.sort(byText);
      expect(expectConsistent(list)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
      for (const node of list.nodes()) expect(node).toBe(before.get(node.value));
    });
  });

  it('printList shows the links', () => {
    expect(listOf('A', 'B').printList()).toBe('null ← A ⇄ B → null');
  });
});
