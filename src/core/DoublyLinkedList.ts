import { Node } from './Node';

/**
 * Doubly linked list, translated from the class code
 * (head, tail, length, append, prepend, traverseToIndex, insert, remove, printList)
 * and extended with the operations a music player needs.
 *
 * This class knows nothing about the DOM or audio: it only manages nodes and links.
 */
export class DoublyLinkedList<T> implements Iterable<T> {
  head: Node<T> | null = null;
  tail: Node<T> | null = null;
  length = 0;

  /** Add to the end. O(1) thanks to the tail reference. */
  append(value: T): Node<T> {
    const node = new Node(value);
    this.linkAtEnd(node);
    return node;
  }

  /** Add to the start. O(1). */
  prepend(value: T): Node<T> {
    const node = new Node(value);
    this.linkAtStart(node);
    return node;
  }

  /**
   * Returns the node at `index`, or null when the index is out of range.
   * Walks from the head or from the tail, whichever is closer:
   * an advantage only a doubly linked list offers. O(n/2).
   */
  traverseToIndex(index: number): Node<T> | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) return null;

    if (index < this.length / 2) {
      let current = this.head;
      for (let i = 0; i < index; i++) current = current!.next;
      return current;
    }

    let current = this.tail;
    for (let i = this.length - 1; i > index; i--) current = current!.prev;
    return current;
  }

  /** Insert specifying the index. Index <= 0 prepends, index >= length appends. */
  insert(index: number, value: T): Node<T> {
    const node = new Node(value);
    this.linkAt(index, node);
    return node;
  }

  /**
   * Insert right after a node that belongs to this list. O(1): no traversal,
   * the new node is linked between `node` and `node.next` (it becomes the tail
   * when `node` was the tail).
   */
  insertAfter(node: Node<T>, value: T): Node<T> {
    const fresh = new Node(value);
    this.linkAfter(node, fresh);
    return fresh;
  }

  /** Relinks `node` right after `ref` (both in this list). The node is not recreated. O(1). */
  moveAfter(node: Node<T>, ref: Node<T>): void {
    if (node === ref || ref.next === node) return;
    this.unlink(node);
    this.linkAfter(ref, node);
  }

  /** Relinks `node` right before `ref` (both in this list). The node is not recreated. O(1). */
  moveBefore(node: Node<T>, ref: Node<T>): void {
    if (node === ref || ref.prev === node) return;
    this.unlink(node);
    this.linkBefore(ref, node);
  }

  /** Relinks `node` (in this list) as the new head. O(1). */
  moveToFront(node: Node<T>): void {
    if (node === this.head) return;
    this.unlink(node);
    this.linkAtStart(node);
  }

  /** Delete specifying the index. Returns the removed value, or null if out of range. */
  remove(index: number): T | null {
    const node = this.traverseToIndex(index);
    if (!node) return null;
    this.unlink(node);
    return node.value;
  }

  /** O(1) removal when the node reference is already known (e.g. the current song). */
  removeNode(node: Node<T>): T {
    this.unlink(node);
    return node.value;
  }

  /** First node whose value satisfies the predicate. */
  findNode(predicate: (value: T) => boolean): Node<T> | null {
    for (let current = this.head; current; current = current.next) {
      if (predicate(current.value)) return current;
    }
    return null;
  }

  /** Position of a node in the list, or -1 if it does not belong to it. */
  indexOf(node: Node<T>): number {
    let index = 0;
    for (let current = this.head; current; current = current.next, index++) {
      if (current === node) return index;
    }
    return -1;
  }

  /**
   * Moves the node at `fromIndex` so it ends up at `toIndex`.
   * The node is relinked, not recreated, so outside references stay valid.
   */
  move(fromIndex: number, toIndex: number): boolean {
    const node = this.traverseToIndex(fromIndex);
    if (!node || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this.length) return false;
    if (fromIndex === toIndex) return true;
    this.unlink(node);
    this.linkAt(toIndex, node);
    return true;
  }

  /** Reverses the list in place by swapping each node's next and prev links. O(n). */
  reverse(): void {
    let current = this.head;
    while (current) {
      const following = current.next;
      current.next = current.prev;
      current.prev = following;
      current = following;
    }
    const oldHead = this.head;
    this.head = this.tail;
    this.tail = oldHead;
  }

  /**
   * Shuffles by relinking the existing nodes (Fisher–Yates over the links):
   * a random node from the unshuffled part is unlinked and appended at the tail.
   */
  shuffle(random: () => number = Math.random): void {
    for (let remaining = this.length; remaining > 1; remaining--) {
      const pick = Math.floor(random() * remaining);
      const node = this.traverseToIndex(pick)!;
      this.unlink(node);
      this.linkAtEnd(node);
    }
  }

  /**
   * Stable merge sort that relinks the existing nodes: no new nodes, no array copy.
   * The `next` chain is sorted first, then a single pass rebuilds every `prev`
   * link and the tail. O(n log n) time, O(log n) recursion depth.
   * Outside references to nodes (like a playlist's current node) stay valid.
   */
  sort(compare: (a: T, b: T) => number): void {
    if (this.length < 2) return;
    this.head = this.mergeSort(this.head!, this.length, compare);

    let previous: Node<T> | null = null;
    for (let node: Node<T> | null = this.head; node; node = node.next) {
      node.prev = previous;
      previous = node;
    }
    this.tail = previous;
  }

  clear(): void {
    // Break the links so the garbage collector can reclaim every node.
    let current = this.head;
    while (current) {
      const following = current.next;
      current.next = null;
      current.prev = null;
      current = following;
    }
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  /** Iterates over the nodes from head to tail. */
  *nodes(): Generator<Node<T>> {
    for (let current = this.head; current; current = current.next) yield current;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (const node of this.nodes()) yield node.value;
  }

  /** Text form of the list, like the class's print_list: null ← A ⇄ B ⇄ C → null */
  printList(format: (value: T) => string = String): string {
    if (!this.head) return 'null';
    const parts: string[] = [];
    for (const value of this) parts.push(format(value));
    return `null ← ${parts.join(' ⇄ ')} → null`;
  }

  // ---- Low-level linking helpers ----

  private linkAtStart(node: Node<T>): void {
    if (!this.head) {
      this.head = node;
      this.tail = node;
    } else {
      node.next = this.head;
      this.head.prev = node;
      this.head = node;
    }
    this.length++;
  }

  private linkAtEnd(node: Node<T>): void {
    if (!this.tail) {
      this.head = node;
      this.tail = node;
    } else {
      node.prev = this.tail;
      this.tail.next = node;
      this.tail = node;
    }
    this.length++;
  }

  private linkAt(index: number, node: Node<T>): void {
    if (index <= 0) return this.linkAtStart(node);
    if (index >= this.length) return this.linkAtEnd(node);

    const after = this.traverseToIndex(index)!;
    const before = after.prev!;
    node.prev = before;
    node.next = after;
    before.next = node;
    after.prev = node;
    this.length++;
  }

  private linkAfter(anchor: Node<T>, node: Node<T>): void {
    node.prev = anchor;
    node.next = anchor.next;
    if (anchor.next) anchor.next.prev = node;
    else this.tail = node;
    anchor.next = node;
    this.length++;
  }

  private linkBefore(ref: Node<T>, node: Node<T>): void {
    node.next = ref;
    node.prev = ref.prev;
    if (ref.prev) ref.prev.next = node;
    else this.head = node;
    ref.prev = node;
    this.length++;
  }

  /** Sorts the `length` nodes starting at `head` by their `next` links; returns the new first node. */
  private mergeSort(head: Node<T>, length: number, compare: (a: T, b: T) => number): Node<T> {
    if (length === 1) {
      head.next = null;
      return head;
    }
    const half = Math.floor(length / 2);
    let middle = head;
    for (let i = 0; i < half; i++) middle = middle.next!;
    // `middle` is read before recursing: sorting the left half cuts its links.
    const left = this.mergeSort(head, half, compare);
    const right = this.mergeSort(middle, length - half, compare);
    return this.merge(left, right, compare);
  }

  /** Merges two sorted chains. Ties take the left node first, which keeps the sort stable. */
  private merge(a: Node<T> | null, b: Node<T> | null, compare: (a: T, b: T) => number): Node<T> {
    let first: Node<T> | null = null;
    let last: Node<T> | null = null;
    while (a && b) {
      let pick: Node<T>;
      if (compare(a.value, b.value) <= 0) {
        pick = a;
        a = a.next;
      } else {
        pick = b;
        b = b.next;
      }
      if (last) last.next = pick;
      else first = pick;
      last = pick;
    }
    last!.next = a ?? b;
    return first!;
  }

  private unlink(node: Node<T>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;

    node.next = null;
    node.prev = null;
    this.length--;
  }
}
