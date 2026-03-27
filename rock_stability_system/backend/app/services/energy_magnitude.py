import math

def calculate_magnitude(energy: float) -> float:
    """
    根据给定的能量（焦耳），计算微震及声发射事件的等效震级 (Magnitude, M)。
    经典古登堡-里克特(G-R)和微震能量-震级转换经验公式的一种变体：
    M = (2/3) * log10(E) - 2.9
    
    参数:
        energy (float): 事件释放能量 (J)
        
    返回:
        float: 计算得到的震级，保留 2 位小数
    """
    if energy <= 0:
        return -3.0 # 非常小的本底噪声震级
        
    try:
        # M = 2/3 * log10(E) - 2.9
        magnitude = (2.0 / 3.0) * math.log10(energy) - 2.9
        return round(magnitude, 2)
    except Exception as e:
        print(f"Error calculating magnitude for energy {energy}: {e}")
        return 0.0
