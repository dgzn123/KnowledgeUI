#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int inspect_after_exec(void) {
    assert(fcntl(3, F_GETFD) == 0);
    assert(lseek(3, 0, SEEK_CUR) == 4);
    errno = 0;
    assert(fcntl(4, F_GETFD) == -1 && errno == EBADF);
    puts("child after exec: fd 3 offset = 4");
    puts("child after exec: fd 4 = EBADF");
    return 0;
}

int main(int argc, char *argv[]) {
    assert(argc == 2);
    if (strcmp(argv[1], "--inspect") == 0) {
        return inspect_after_exec();
    }

    int shared = open(argv[1], O_RDONLY);
    int private_open = open(argv[1], O_RDONLY | O_CLOEXEC);
    assert(shared == 3);
    assert(private_open == 4);
    assert(lseek(shared, 0, SEEK_CUR) == 0);
    assert(lseek(private_open, 0, SEEK_CUR) == 0);

    pid_t pid = fork();
    assert(pid >= 0);
    if (pid == 0) {
        assert(fcntl(private_open, F_GETFD) == FD_CLOEXEC);
        char bytes[4];
        assert(read(shared, bytes, sizeof bytes) == (ssize_t)sizeof bytes);
        assert(memcmp(bytes, "abcd", sizeof bytes) == 0);

        char *child_argv[] = { argv[0], "--inspect", NULL };
        char *child_env[] = { NULL };
        assert(execve("", child_argv, child_env) == -1 && errno == ENOENT);
        assert(fcntl(private_open, F_GETFD) == FD_CLOEXEC);
        execve(argv[0], child_argv, child_env);
        _exit(127);
    }

    int status;
    assert(waitpid(pid, &status, 0) == pid);
    assert(WIFEXITED(status) && WEXITSTATUS(status) == 0);
    assert(lseek(shared, 0, SEEK_CUR) == 4);
    assert(lseek(private_open, 0, SEEK_CUR) == 0);
    assert(fcntl(private_open, F_GETFD) == FD_CLOEXEC);
    puts("parent after wait: fd 3 offset = 4, fd 4 offset = 0");
    assert(close(shared) == 0);
    assert(close(private_open) == 0);
    return 0;
}
