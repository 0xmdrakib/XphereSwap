// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract WXP {
    string public name = "Wrapped Xphere";
    string public symbol = "WXP";
    uint8 public decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "WXP: insufficient balance");
        unchecked {
            balanceOf[msg.sender] -= wad;
            totalSupply -= wad;
        }
        emit Withdrawal(msg.sender, wad);
        emit Transfer(msg.sender, address(0), wad);
        (bool ok, ) = msg.sender.call{value: wad}("");
        require(ok, "WXP: XP transfer failed");
    }

    function approve(address guy, uint256 wad) external returns (bool) {
        allowance[msg.sender][guy] = wad;
        emit Approval(msg.sender, guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) external returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint256 wad) public returns (bool) {
        require(dst != address(0), "WXP: zero destination");
        require(balanceOf[src] >= wad, "WXP: insufficient balance");

        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "WXP: insufficient allowance");
            unchecked {
                allowance[src][msg.sender] -= wad;
            }
        }

        unchecked {
            balanceOf[src] -= wad;
            balanceOf[dst] += wad;
        }
        emit Transfer(src, dst, wad);
        return true;
    }
}
