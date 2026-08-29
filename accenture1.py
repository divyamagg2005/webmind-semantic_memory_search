n = input()

if n == n[::-1]:
    print("Palindrome")
else:
    print("Not Palindrome")

    for i in range(len(n)):
        if n[i] != n[len(n)-1-i]:
            print(f"Mismatch at index {i}: {n[i]} != {n[len(n)-1-i]}")
            break

        