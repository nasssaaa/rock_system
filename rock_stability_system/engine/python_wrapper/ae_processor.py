import numpy as np
from typing import Tuple, List

class AEProcessor:
    """
    千米深地围岩声发射 (Acoustic Emission, AE) 数据处理核心引擎。
    包含基于 TDOA 的震源定位 (Geiger算法) 和基于 b 值分析的稳定性评估。
    """
    
    def __init__(self, v_p: float = 4500.0):
        """
        初始化 AE 数据处理器。
        
        :param v_p: 岩体中 P 波 的平均传播速度 (单位: m/s)，深部坚硬岩石通常在 4000~6000 之间。
        """
        self.v_p = v_p

    def locate_source_geiger(self, 
                             sensor_coords: np.ndarray, 
                             arrival_times: np.ndarray, 
                             initial_guess: np.ndarray = None, 
                             max_iter: int = 50, 
                             tol: float = 1e-4) -> Tuple[np.ndarray, float]:
        """
        使用 Geiger 方法（一种非线性最小二乘法，基于 TDOA）计算微震破裂点位置。
        
        数学原理说明 (Geiger 定位):
        设真实震源位于 (x0, y0, z0, t0)，第 i 个传感器坐标为 (xi, yi, zi)，到达时间为 ti。
        理论到达时间 T_i = t0 + sqrt((xi-x0)^2 + (yi-y0)^2 + (zi-z0)^2) / V_p
        残差 r_i = ti - T_i
        我们通过泰勒级数对函数进行线性化，迭代求解增量: 
        [dx, dy, dz, dt] = (G^T * G)^(-1) * G^T * R
        其中 G 为偏导数矩阵 (偏导数为波射线方向余弦)。
        
        :param sensor_coords: (N, 3) 形状的 NumPy 数组，N 个传感器的 (x, y, z) 坐标
        :param arrival_times: (N,) 形状的 NumPy 数组，对应 N 个传感器的波达时间 (秒)
        :param initial_guess: (4,) 震源初始猜测位置和发震时间 [x, y, z, t]。默认为传感器质心和最早到达时间。
        :param max_iter: 最大迭代次数
        :param tol: 收敛容忍残差阈值
        :return: (最优震源坐标/时间 [x, y, z, t], 最终RMS残差值)
        """
        n_sensors = sensor_coords.shape[0]
        if n_sensors < 4:
            raise ValueError("至少需要包含4个传感器的坐标和到达时间才能进行三维空间定位计算。")
            
        # 1. 初始条件设定：如果未提供则用质心和最早击中时间作为试算点
        if initial_guess is None:
            t0_guess = np.min(arrival_times)
            x_guess, y_guess, z_guess = np.mean(sensor_coords, axis=0)
            theta = np.array([x_guess, y_guess, z_guess, t0_guess], dtype=float)
        else:
            theta = np.array(initial_guess, dtype=float)
            
        residual_rms = float('inf')
        
        # 2. 迭代求解非线性最小二乘逼近
        for iteration in range(max_iter):
            x, y, z, t0 = theta
            
            # (N,) 距离计算
            dx = sensor_coords[:, 0] - x
            dy = sensor_coords[:, 1] - y
            dz = sensor_coords[:, 2] - z
            distances = np.sqrt(dx**2 + dy**2 + dz**2)
            
            # 计算理论到达时间
            t_calc = t0 + distances / self.v_p
            
            # 残差向量 R (维度 N)
            R = arrival_times - t_calc
            
            # 若距离极近，防止除0错误
            distances[distances < 1e-6] = 1e-6
            
            # 偏导数/偏回归矩阵 G (Jacobian Matrix, 维度 N x 4)
            # 对 x, y, z, t0 的偏导数
            G = np.zeros((n_sensors, 4))
            G[:, 0] = -dx / (distances * self.v_p)  # dT/dx
            G[:, 1] = -dy / (distances * self.v_p)  # dT/dy
            G[:, 2] = -dz / (distances * self.v_p)  # dT/dz
            G[:, 3] = 1.0                           # dT/dt0
            
            # 最小二乘法解增量 Δθ: (G^T * G) * Δθ = G^T * R
            try:
                # 使用 np.linalg.lstsq 相比直接求逆更稳定 
                d_theta, residuals, rank, s = np.linalg.lstsq(G, R, rcond=None)
            except np.linalg.LinAlgError:
                # 矩阵奇异奇异退化处理 (例如传感器共面引起的不适定方程)
                break
                
            # 更新估计值
            theta += d_theta
            
            # 计算均方根残差
            current_rms = np.sqrt(np.mean(R**2))
            
            # 3. 检查是否收敛：当增量的无穷范数小于阈值时
            if np.max(np.abs(d_theta)) < tol:
                residual_rms = current_rms
                break
                
            residual_rms = current_rms
            
        return theta, residual_rms

    def evaluate_stability_b_value(self, magnitudes: np.ndarray, mag_threshold: float = 0.0) -> float:
        """
        基于声发射事件星级（如震级大小）历史序列，计算 Gutenberg-Richter (G-R) 关系的 b 值，进而评价稳定性。
        
        数学原理说明 (b-value):
        G-R 关系式: log10(N(>=M)) = a - b * M
        N(>=M) 是发生大于或等于震级 M 的事件总数。
        高 b 值：代表小破裂事件占比高，能量释放缓慢，系统相对稳定。
        低/下降的 b 值：大级别破裂比例升高，主破裂可能即将发生（如顶板断裂/冲击地压）。
        
        这里采用极大似然估计 (Aki 最大似然估计公式):
        b = log10(e) / (M_mean - (M_min - dM/2))
        
        为了返回更直观的【失稳风险指数 (0到1)】，我们通过阈值进行归一化映射。（这只是一种经验映射）
        
        :param magnitudes: NumPy数组，表示时间窗内捕获的一系列 AE 事件能量大小(震级或振幅对数)
        :param mag_threshold: 最小完备震级 (Mc)，小于此震级的事件不计入统计以防止漏测偏差
        :return: (float) 稳定性风险指数 (Risk Index)，范围 [0.0, 1.0]。 1代表极限高危状态。
        """
        # 提取超过阈值的数据
        valid_mags = magnitudes[magnitudes >= mag_threshold]
        
        if len(valid_mags) < 10:
            # 样本量过小，不足以计算统计学意义 b 值，返回中间保守值或0
            return 0.5 
            
        mean_mag = np.mean(valid_mags)
        min_mag = np.min(valid_mags)
        # 为修正离散度, 加入小增量补丁, 这里设 dM / 2 约为 0.05
        # dM 依赖于传感器数据精度
        delta_M = 0.1 
        
        # 最大似然估计法求解 b
        b_value = np.log10(np.exp(1)) / (mean_mag - (min_mag - delta_M / 2))
        
        # ---------- 经验映射机制 ----------
        # b 值在坚硬岩体（如千米深巷道）通常在 0.5 到 1.5 之间。
        # 假设：
        # b <= 0.6 -> 岩体积聚高能，随时引发明显动力学灾害 (Risk -> 1.0)
        # b >= 1.2 -> 稳定释放微裂纹 (Risk -> 0.0)
        
        b_danger_thresh = 0.6
        b_safe_thresh = 1.2
        
        if b_value <= b_danger_thresh:
            risk_index = 1.0
        elif b_value >= b_safe_thresh:
            risk_index = 0.0
        else:
            # 线性插值映射
            risk_index = 1.0 - (b_value - b_danger_thresh) / (b_safe_thresh - b_danger_thresh)
            
        return risk_index


# --- 以下为内部测试验证用例模块 ---
if __name__ == "__main__":
    # 测试 AE 处理器定位功能
    processor = AEProcessor(v_p=5000.0)  # 波速 5000 m/s
    
    # 模拟在千米深矿的 5 个围岩传感器坐标 (x, y, z) 
    test_sensors = np.array([
        [10.0, 10.0, 10.0],
        [-10.0, 10.0, 10.0],
        [10.0, -10.0, 10.0],
        [-10.0, -10.0, 10.0],
        [0.0, 0.0, -10.0]
    ])
    
    # 假设震源发生在坐标 [2.0, -3.0, 5.0]，发震时间 t0=100.0秒
    true_x, true_y, true_z, true_t = 2.0, -3.0, 5.0, 100.0
    
    # 正演计算：生成理想的到达时间，并加入微量噪声
    true_distances = np.sqrt(np.sum((test_sensors - np.array([true_x, true_y, true_z]))**2, axis=1))
    test_arrivals = true_t + true_distances / processor.v_p
    # 注入微秒级噪声 (+- 0.5 ms)
    noise = np.random.normal(0, 0.0005, size=test_sensors.shape[0])
    test_arrivals += noise
    
    # 运行定位反演
    result_theta, rms = processor.locate_source_geiger(test_sensors, test_arrivals)
    print("--- 震源定位测试 ---")
    print(f"真实位置/发震时间：X={true_x}, Y={true_y}, Z={true_z}, T0={true_t}")
    print(f"求解位置/发震时间：X={result_theta[0]:.2f}, Y={result_theta[1]:.2f}, Z={result_theta[2]:.2f}, T0={result_theta[3]:.4f}")
    print(f"方差 (RMS) 拟合残差：{rms:.6f}\n")
    
    # --- 测试 b 值与风险指数评估 ---
    print("--- b 值稳定性演化评估测试 ---")
    # 生成一系列服从古登堡-理查特分布的高震级样本 (高b值稳定状态)
    stable_mags = np.random.exponential(scale=0.3, size=200) + 1.0
    risk_stable = processor.evaluate_stability_b_value(stable_mags, mag_threshold=1.0)
    print(f"[稳定工况下] -> 高 b 值模拟，输出风险指数 Risk Index: {risk_stable:.3f}")
    
    # 生成一系列含较大震级比例的危险样本 (大破裂主导，低b值高危状态)
    danger_mags = np.random.exponential(scale=0.9, size=200) + 1.0 # 扩大尾部
    risk_danger = processor.evaluate_stability_b_value(danger_mags, mag_threshold=1.0)
    print(f"[高危工况下] -> 低 b 值大事件主导，输出风险指数 Risk Index: {risk_danger:.3f}")
