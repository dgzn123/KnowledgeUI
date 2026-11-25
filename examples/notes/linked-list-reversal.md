# 原地反转单链表与二叉树递归遍历

单链表反转时，当前位置只有一条向后可走的边。写入 `curr->next` 之前必须保存后继，否则还没处理的后缀可能无法抵达。树的递归遍历也要保留“下一步去哪里”，只是它通过调用栈保存返回位置。

## 原地反转单链表

前提是可修改、无环的单链表。`prev` 指向已反转前缀的头，`curr` 指向未处理后缀的头。每轮开始时这两段覆盖原链表的全部节点，互不相交。先记住 `next`，再反转当前边并推进两个指针，循环不变量在下一轮重新成立。

```c
Node *reverse(Node *head) {
    Node *prev = NULL;
    Node *curr = head;
    while (curr != NULL) {
        Node *next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }
    return prev;
}
```

从 `A → B → C → ∅` 开始。下面分别记录本轮的工作指针和节点自身的 `next`。`—` 表示局部变量不在作用域。

每行依次给出 `prev / curr / next` 与 `A.next / B.next / C.next`。

- 初始化 · ∅ / A / — · B / C / ∅
- 保存第一轮后继 · ∅ / A / B · B / C / ∅
- 改写 A 的边 · ∅ / A / B · ∅ / C / ∅
- 第一轮推进 · A / B / — · ∅ / C / ∅
- 保存第二轮后继 · A / B / C · ∅ / C / ∅
- 改写 B 的边 · A / B / C · ∅ / A / ∅
- 第二轮推进 · B / C / — · ∅ / A / ∅
- 保存第三轮后继 · B / C / ∅ · ∅ / A / ∅
- 改写 C 的边 · B / C / ∅ · ∅ / A / B
- 第三轮推进并退出 · C / ∅ / — · ∅ / A / B

节点一直留在原处，改动的是指针。第二轮将 `B → C` 改成 `B → A` 后，`next` 暂时是到 C 的唯一已保存入口。最后 `curr = NULL`，`prev` 指向 `C → B → A → ∅`，应把返回值作为新的头。空表返回空，单节点表返回原节点，长度为 `n` 时做 `O(n)` 次操作，使用 `O(1)` 额外空间。存在环时不满足证明前提，应先按输入契约处理。 [MIT 6.088 原地反转演示](https://ocw.mit.edu/courses/6-088-introduction-to-c-memory-management-and-c-object-oriented-programming-january-iap-2010/9b6fe52f9cf7d286e6f2ec9c938a40f8_MIT6_088IAP10_lec03.pdf)

推进到「改写 B 的边」。蓝色的节点边指向 A，带 `next` 标签的工作指针还指向 C。前进一次后，`curr` 接过 C，下一轮仍能找到它。指向空值的链接在节点或指针标签中标为 ∅。窄屏可在图内横向滚动查看 C。

```kui
version: 1
type: interactive
state:
  step: {type: number, default: 0, min: 0, max: 9, step: 1}
data:
  frames:
    - {lines: [{from: 2, to: 3}], prev: nil, curr: A, next: hidden, a: B, b: C, c: nil}
    - {lines: [5], prev: nil, curr: A, next: B, a: B, b: C, c: nil}
    - {lines: [6], prev: nil, curr: A, next: B, a: nil, b: C, c: nil}
    - {lines: [{from: 7, to: 8}], prev: A, curr: B, next: hidden, a: nil, b: C, c: nil}
    - {lines: [5], prev: A, curr: B, next: C, a: nil, b: C, c: nil}
    - {lines: [6], prev: A, curr: B, next: C, a: nil, b: A, c: nil}
    - {lines: [{from: 7, to: 8}], prev: B, curr: C, next: hidden, a: nil, b: A, c: nil}
    - {lines: [5], prev: B, curr: C, next: nil, a: nil, b: A, c: nil}
    - {lines: [6], prev: B, curr: C, next: nil, a: nil, b: A, c: B}
    - {lines: [4, 10], prev: C, curr: nil, next: hidden, a: nil, b: A, c: B}
computed:
  frame: frames[step]
layout:
  type: stack
  children:
    - type: stepper
      bind: step
      label: 反转的暂停点
      labels: [初始化, 保存 B, 改写 A 的边, 推进到 B, 保存 C, 改写 B 的边, 推进到 C, 保存空后继, 改写 C 的边, 返回 C]
    - type: graph
      title: 节点边与工作指针
      grid: {columnWidth: 112, rowHeight: 86}
      nodes:
        - {id: prevPtr, label: "prev → {{frame.prev == 'nil' ? '∅' : frame.prev}}", position: {row: 0, column: 0}, width: 91, height: 41}
        - {id: currPtr, label: "curr → {{frame.curr == 'nil' ? '∅' : frame.curr}}", position: {row: 0, column: 1}, width: 91, height: 41}
        - {id: nextPtr, label: "next → {{frame.next == 'hidden' ? '—' : (frame.next == 'nil' ? '∅' : frame.next)}}", position: {row: 0, column: 2}, width: 91, height: 41}
        - {id: A, label: "A{{frame.a == 'nil' ? ' → ∅' : ''}}", position: {row: 1, column: 0}, width: 91, height: 41, tone: info}
        - {id: B, label: "B{{frame.b == 'nil' ? ' → ∅' : ''}}", position: {row: 1, column: 1}, width: 91, height: 41, tone: info}
        - {id: C, label: "C{{frame.c == 'nil' ? ' → ∅' : ''}}", position: {row: 1, column: 2}, width: 91, height: 41, tone: info}
      edges:
        - {from: prevPtr, to: "{{frame.prev}}", when: "frame.prev != 'nil'", tone: neutral}
        - {from: currPtr, to: "{{frame.curr}}", when: "frame.curr != 'nil'", tone: neutral}
        - {from: nextPtr, to: "{{frame.next}}", when: "frame.next != 'nil' && frame.next != 'hidden'", tone: warning}
        - {from: A, to: "{{frame.a}}", when: "frame.a != 'nil'", tone: info}
        - {from: B, to: "{{frame.b}}", when: "frame.b != 'nil'", tone: info}
        - {from: C, to: "{{frame.c}}", when: "frame.c != 'nil'", tone: info}
    - type: code
      language: c
      lineNumbers: true
      code: |-
        Node *reverse(Node *head) {
            Node *prev = NULL;
            Node *curr = head;
            while (curr != NULL) {
                Node *next = curr->next;
                curr->next = prev;
                prev = curr;
                curr = next;
            }
            return prev;
        }
      highlight: "{{frame.lines}}"
```

## 中序递归遍历的返回点

以这棵有限二叉树为例。中序先遍历左子树，再访问根，最后遍历右子树。空子树立即返回。访问 D 后，调用栈先回到 B。B 的左右分支都结束后，才回到 A。

```text
    A
   / \
  B   C
   \
    D
```

```c
void inorder(Tree *node) {
    if (node == NULL) return;
    inorder(node->left);
    visit(node);
    inorder(node->right);
}
```

- **前序**。两棵子树之前访问根 · A, B, D, C
- **中序**。左右子树之间访问根 · B, D, A, C
- **后序**。两棵子树之后访问根 · D, B, C, A

每个节点恰好访问一次，时间为 `O(n)`。若 `h` 是从根到叶单一路径上的最大节点数，递归栈占 `O(h)`，退化为单链形时可达 `O(n)`。这里计算额外栈空间，未计入保存访问结果的空间。 [MIT 6.005 递归数据类型](https://ocw.mit.edu/ans7870/6/6.005/s16/classes/16-recursive-data-types/recursive/)

步进器停在每次执行 `visit(node)` 的位置。访问 D 时，活动调用路径经过 A → B → D。访问 A 时，B、D 的栈帧都已返回。

```kui
version: 1
type: interactive
state:
  visitIndex: {type: number, default: 0, min: 0, max: 3, step: 1}
data:
  visits:
    - {id: B, path: "A → B", order: B}
    - {id: D, path: "A → B → D", order: "B → D"}
    - {id: A, path: A, order: "B → D → A"}
    - {id: C, path: "A → C", order: "B → D → A → C"}
computed:
  visit: visits[visitIndex]
layout:
  type: stack
  children:
    - {type: stepper, bind: visitIndex, label: 中序访问, labels: [访问 B, 访问 D, 访问 A, 访问 C]}
    - {type: text, body: "活动调用路径 **{{visit.path}}** · 已访问 **{{visit.order}}**", markdown: true}
    - type: graph
      title: 中序遍历的当前节点
      grid: {columnWidth: 103, rowHeight: 67}
      nodes:
        - {id: A, label: A, position: {row: 0, column: 1}, width: 63, height: 38, tone: "{{visit.id == 'A' ? 'info' : 'neutral'}}"}
        - {id: B, label: B, position: {row: 1, column: 0}, width: 63, height: 38, tone: "{{visit.id == 'B' ? 'info' : 'neutral'}}"}
        - {id: C, label: C, position: {row: 1, column: 2}, width: 63, height: 38, tone: "{{visit.id == 'C' ? 'info' : 'neutral'}}"}
        - {id: D, label: D, position: {row: 2, column: 1}, width: 63, height: 38, tone: "{{visit.id == 'D' ? 'info' : 'neutral'}}"}
      edges:
        - {from: A, to: B}
        - {from: A, to: C}
        - {from: B, to: D}
```

**自测**：如果反转时先执行 `curr->next = prev`，再用 `curr->next` 找后继，会怎样？第一轮会读到刚写入的空指针，原来的 B 和 C 无法由这两个工作指针到达。
