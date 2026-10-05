/**
 * A node of a doubly linked list: it stores a value and two links,
 * one to the next node and one to the previous node.
 * Same structure as the class code (value / next / prev).
 */
export class Node<T> {
  value: T;
  next: Node<T> | null = null;
  prev: Node<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}
